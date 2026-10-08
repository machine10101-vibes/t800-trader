/**
 * Always-on desk. Serves the static export and ticks armed books from disk
 * so the browser can close after Arm.
 *
 *   npm run build
 *   npm run desk
 *
 * Then open http://127.0.0.1:8787/t800-trader/ and arm. Keys stay in
 * ~/.t800-trader (or $T800_DATA). This process never uploads them.
 */
process.env.T800_DESK = "1";

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { CHAIN_IDS, type ChainId } from "../src/lib/chain";
import { attachDeskFiles, deskDataDir } from "../src/lib/deskFs";
import { isDeskChain, runnerCronosSession, runnerWalletSession } from "../src/lib/deskHost";
import { useDeskKeys, writeSecret } from "../src/lib/keystore";
import { controlBot } from "../src/lib/client";
import { resumeLiveSession } from "../src/lib/solana/live-session";
import {
  adoptPostedBook,
  getActiveWallet,
  loadState,
  resumeSavedBook,
  useDeskStore,
} from "../src/lib/store";
import { DESK_RUNNER_HOST, DESK_RUNNER_PORT, isDeskApiPath, nextTickWaitMs } from "../src/lib/trading/runtime";
import type { AppState } from "../src/lib/types";

const PORT = Number(process.env.T800_PORT || DESK_RUNNER_PORT);
const ROOT = path.resolve(process.cwd(), "out");
const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeFile(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "");
  let rel = decoded;
  if (rel === "/t800-trader") rel = "/";
  else if (rel.startsWith("/t800-trader/")) rel = rel.slice("/t800-trader/".length);
  else return null;
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT + path.sep) && full !== ROOT) return null;
  return full;
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }
  if (pathname === "/api/desk/status") {
    const armed: Partial<Record<ChainId, boolean>> = {};
    for (const chain of CHAIN_IDS) {
      const wallet = getActiveWallet(chain);
      if (!wallet) continue;
      const state = await loadState(chain).catch(() => null);
      armed[chain] = Boolean(state?.bot.running);
    }
    send(res, 200, { ok: true, runner: true, port: PORT, armed });
    return;
  }
  if (pathname === "/api/desk/keys" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}") as { keys?: Record<string, string> };
    for (const [key, value] of Object.entries(body.keys ?? {})) {
      if (typeof value === "string" && value.length > 0) writeSecret(key, value);
    }
    send(res, 200, { ok: true });
    return;
  }
  const chain = pathname.replace("/api/desk/", "");
  if (!isDeskChain(chain)) {
    send(res, 404, { error: "unknown desk" });
    return;
  }
  if (req.method === "GET") {
    const wallet = getActiveWallet(chain);
    if (!wallet) {
      send(res, 204, "");
      return;
    }
    const state = await loadState(chain);
    send(res, 200, { wallet, state });
    return;
  }
  if (req.method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}") as {
      wallet?: string;
      state?: AppState;
      keys?: Record<string, string>;
    };
    if (!body.wallet || !body.state?.config || !body.state.portfolio) {
      send(res, 400, { error: "book missing" });
      return;
    }
    for (const [key, value] of Object.entries(body.keys ?? {})) {
      if (typeof value === "string" && value.length > 0) writeSecret(key, value);
    }
    const state = await adoptPostedBook(chain, body.wallet, body.state);
    send(res, 200, { ok: true, wallet: body.wallet, running: state.bot.running });
    return;
  }
  send(res, 405, { error: "method" });
}

function handleStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
  if (pathname === "/" || pathname === "") {
    res.writeHead(302, { Location: "/t800-trader/" });
    res.end();
    return;
  }
  const file = safeFile(pathname);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  const type = MIME[path.extname(file)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}

async function tickChain(chain: ChainId): Promise<{ scan: number; liveOpen: boolean } | null> {
  if (!getActiveWallet(chain)) await resumeSavedBook(chain).catch(() => null);
  const wallet = getActiveWallet(chain);
  if (!wallet) return null;
  const state = await loadState(chain);
  if (!state.bot.running) return null;
  if (state.config.walletSwaps) resumeLiveSession();
  const session = chain === "cronos" ? runnerCronosSession(wallet) : runnerWalletSession(wallet);
  await controlBot("tick", session, chain);
  return {
    scan: state.config.scanSeconds,
    liveOpen: state.positions.some((pos) => pos.signature || (pos.leverage ?? 1) > 1),
  };
}

async function tickLoop(): Promise<void> {
  for (;;) {
    const started = Date.now();
    let scan = 5;
    let liveOpen = false;
    for (const chain of CHAIN_IDS) {
      try {
        const result = await tickChain(chain);
        if (!result) continue;
        scan = result.scan;
        liveOpen = liveOpen || result.liveOpen;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[${chain}] ${message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, nextTickWaitMs({ scanSeconds: scan, openLivePosition: liveOpen, usedMs: Date.now() - started })));
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(ROOT, "index.html"))) {
    console.error("Build the desk first: npm run build");
    process.exit(1);
  }
  const files = attachDeskFiles();
  useDeskKeys(files.keys);
  useDeskStore(files.store);
  for (const chain of CHAIN_IDS) {
    await resumeSavedBook(chain).catch(() => null);
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${DESK_RUNNER_HOST}:${PORT}`);
    void (async () => {
      try {
        if (isDeskApiPath(url.pathname)) {
          await handleApi(req, res, url.pathname);
          return;
        }
        handleStatic(req, res, url.pathname);
      } catch (error) {
        const message = error instanceof Error ? error.message : "desk error";
        if (!res.headersSent) send(res, 500, { error: message });
      }
    })();
  });
  server.listen(PORT, DESK_RUNNER_HOST, () => {
    console.log(`Desk runner http://${DESK_RUNNER_HOST}:${PORT}/t800-trader/`);
    console.log(`Books and keys stay in ${deskDataDir()}`);
    console.log("Arm from that address, then you can close the browser. Stop this process to stop the bot.");
  });
  void tickLoop();
}

void main();
