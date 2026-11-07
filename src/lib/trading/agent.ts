import { WATCHLIST, type WatchToken } from "@/lib/market/universe";
import type { AgentGrant, AgentOrder, AppState, BotConfig, ChainOrder, Signal } from "@/lib/types";
import { id } from "@/lib/utils";
import { agentPermissionBlock } from "./agentPermission";
import { closePosition, openPosition } from "./paper";
import { MIN_TICKET_USD } from "./risk";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ACTIVE = 3;
const MAX_USD = 100_000;

export interface AgentBook {
  chain: "solana";
  mode: "paper" | "live";
  armed: boolean;
  running: boolean;
  equityUsd: number;
  cashUsd: number;
  account?: string;
  positions: Array<{
    symbol: string;
    mint: string;
    side: "long" | "short";
    qty: number;
    entryPrice: number;
    markPrice: number;
  }>;
  /** On while the wallet's signed window has not ended. */
  permission: "on" | "off";
  permissionUntil?: string;
  note: string;
}

export interface AgentFill {
  action: "buy" | "sell" | "queued";
  symbol: string;
  usd?: number;
  qty?: number;
  price?: number;
}

export interface AgentCommand {
  code?: string;
  action?: string;
  symbol?: string;
  usd?: number;
  price?: number;
  account?: string;
}

export type AgentReply =
  | { ok: true; status: number; book: AgentBook; fill?: AgentFill; state?: AppState }
  | { ok: false; status: number; error: string };

export function normalizeAgentCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function mintAgentCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const raw = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export async function hashAgentCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeAgentCode(code)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function viewAgentGrants(state: AppState): Array<Pick<AgentGrant, "id" | "label" | "createdAt" | "revokedAt">> {
  return (state.agentGrants ?? []).map(({ id: grantId, label, createdAt, revokedAt }) => ({
    id: grantId,
    label,
    createdAt,
    revokedAt,
  }));
}

export function solanaWatch(symbol: string): WatchToken | undefined {
  const key = symbol.trim().toUpperCase();
  if (!key || key.length > 12) return undefined;
  return WATCHLIST.find((row) => row.symbol.toUpperCase() === key);
}

export function grokManualSignal(order: Pick<AgentOrder, "symbol" | "mint" | "price">, config: BotConfig): Signal | null {
  const token = solanaWatch(order.symbol);
  const price = order.price ?? 0;
  if (!token || token.mint !== order.mint || !(price > 0)) return null;
  return {
    id: id("manual"),
    mint: token.mint,
    symbol: token.symbol,
    poolAddress: token.pool ?? "",
    sector: token.sector,
    side: "long",
    reason: "manual",
    confidence: 50,
    price,
    stopPct: config.stopLossPct,
    targetPct: config.targetProfitPct,
    thesis: "Grok agent asked for this buy.",
    researchScore: null,
    createdAt: new Date().toISOString(),
    setupFrame: "15m",
  };
}

export function grokOpenOrder(order: Pick<AgentOrder, "symbol" | "mint" | "usd" | "price">, config: BotConfig): ChainOrder | null {
  const price = order.price ?? 0;
  const usd = order.usd ?? 0;
  if (!(price > 0) || !(usd > 0)) return null;
  return {
    kind: "open",
    side: "long",
    mint: order.mint,
    symbol: order.symbol,
    notionalUsd: usd,
    qty: usd / price,
    price,
    venues: config.venues,
  };
}

export async function issueAgentGrant(
  state: AppState,
  now = new Date().toISOString(),
): Promise<{ ok: true; state: AppState; code: string } | { ok: false; error: string }> {
  const grants = state.agentGrants ?? [];
  const active = grants.filter((grant) => !grant.revokedAt);
  if (active.length >= MAX_ACTIVE) return { ok: false, error: "Revoke an old Grok code first. Three can be active." };
  const code = mintAgentCode();
  const grant: AgentGrant = {
    id: id("agent"),
    codeHash: await hashAgentCode(code),
    label: "Grok",
    createdAt: now,
  };
  const kept = grants.filter((row) => !row.revokedAt).concat(grants.filter((row) => row.revokedAt).slice(-5));
  return { ok: true, code, state: { ...state, agentGrants: [...kept, grant] } };
}

export function revokeAgentGrant(state: AppState, grantId: string, now = new Date().toISOString()): AppState {
  return {
    ...state,
    agentGrants: (state.agentGrants ?? []).map((grant) =>
      grant.id === grantId && !grant.revokedAt ? { ...grant, revokedAt: now } : grant,
    ),
  };
}

function bookOf(state: AppState, account: string | undefined, note: string): AgentBook {
  const live = Boolean(state.config.walletSwaps);
  const armed = Boolean(live && state.bot.swapBot);
  const permissionOn = agentPermissionBlock(state) === null;
  return {
    chain: "solana",
    mode: live ? "live" : "paper",
    armed,
    running: state.bot.running,
    equityUsd: state.portfolio.equityUsd,
    cashUsd: state.portfolio.cashUsd,
    ...(account && account !== state.bot.swapBot ? { account } : {}),
    positions: state.positions.map((pos) => ({
      symbol: pos.symbol,
      mint: pos.mint,
      side: pos.side,
      qty: pos.qty,
      entryPrice: pos.entryPrice,
      markPrice: pos.markPrice,
    })),
    permission: permissionOn ? "on" : "off",
    ...(state.bot.agentSession?.expiresAt ? { permissionUntil: state.bot.agentSession.expiresAt } : {}),
    note,
  };
}

function fail(status: number, error: string): AgentReply {
  return { ok: false, status, error };
}

async function matchedGrant(state: AppState, code: string): Promise<AgentGrant | AgentReply> {
  const normalized = normalizeAgentCode(code);
  if (normalized.length < 8) return fail(400, "Enter the Grok code from the Sol desk.");
  const hash = await hashAgentCode(code);
  const matches = (state.agentGrants ?? []).filter((grant) => grant.codeHash === hash);
  if (!matches.length) return fail(401, "That code does not match a Grok code on this Sol book.");
  const live = matches.find((grant) => !grant.revokedAt);
  if (!live) return fail(401, "That Grok code was revoked.");
  return live;
}

function readUsd(usd: number | undefined, cash: number): number | AgentReply {
  if (usd === undefined || !Number.isFinite(usd)) return fail(400, "Send the dollar size with the buy.");
  if (usd < MIN_TICKET_USD) return fail(400, `A buy has to be at least $${MIN_TICKET_USD}.`);
  if (usd > MAX_USD) return fail(400, `A Grok buy stays at or under $${MAX_USD}.`);
  if (usd > cash + 1e-9) return fail(400, `Cash on this book is $${cash.toFixed(2)}. That buy is $${usd.toFixed(2)}.`);
  return usd;
}

export async function applyAgentCommand(state: AppState, command: AgentCommand): Promise<AgentReply> {
  const action = (command.action ?? "connect").trim().toLowerCase();
  if (action !== "connect" && action !== "buy" && action !== "sell") {
    return fail(400, "Use connect, buy, or sell.");
  }
  const grant = await matchedGrant(state, command.code ?? "");
  if ("ok" in grant) return grant;

  if (action === "connect") {
    const live = Boolean(state.config.walletSwaps);
    const armed = Boolean(live && state.bot.swapBot);
    const permission = agentPermissionBlock(state);
    const note = permission
      ? permission
      : !live
        ? "Connected. Buys and sells in this signed window fill now and do not ask the wallet again."
        : armed && state.bot.running
          ? "Connected. A buy or sell in this signed window is sent through the trading key without another wallet prompt."
          : "Connected. Arm and start the Sol desk once. Agent trades in this signed window do not ask the wallet again.";
    return { ok: true, status: 200, book: bookOf(state, command.account, note) };
  }

  const token = solanaWatch(command.symbol ?? "");
  if (!token) return fail(400, "That symbol is not on the Solana watchlist.");
  const permission = agentPermissionBlock(state);
  if (permission) return fail(403, permission);
  const held = state.positions.find((pos) => pos.symbol.toUpperCase() === token.symbol);

  if (action === "sell") {
    if (!held) return fail(400, `This book has no ${token.symbol} to sell.`);
    if (state.config.walletSwaps) return queueLive(state, command.account, token, "sell");
    const next = closePosition(state, held.id, held.markPrice, "manual");
    const closed = next.positions.every((pos) => pos.id !== held.id);
    if (!closed) return fail(400, `Could not sell ${token.symbol}.`);
    const note = `Sold ${token.symbol}.`;
    return {
      ok: true,
      status: 200,
      state: { ...next, bot: { ...next.bot, lastNote: `Grok agent sold ${token.symbol}` } },
      book: bookOf({ ...next, bot: { ...next.bot, lastNote: note } }, command.account, note),
      fill: { action: "sell", symbol: token.symbol, qty: held.qty, price: held.markPrice },
    };
  }

  if (held) return fail(400, `This book already holds ${token.symbol}. Sell it before another buy.`);
  const usd = readUsd(command.usd, state.portfolio.cashUsd);
  if (typeof usd !== "number") return usd;
  const price = command.price;
  if (price === undefined || !Number.isFinite(price) || !(price > 0) || price > 1e9) {
    return fail(400, "Send the dollar price with the buy.");
  }
  if (state.config.walletSwaps) return queueLive(state, command.account, token, "buy", usd, price);

  const signal = grokManualSignal({ symbol: token.symbol, mint: token.mint, price }, state.config);
  if (!signal) return fail(400, "That symbol is not on the Solana watchlist.");
  const qty = usd / price;
  const next = openPosition(state, signal, qty);
  const opened = next.positions.find((pos) => pos.symbol === token.symbol && pos.reason === "manual");
  if (!opened) return fail(400, "Not enough cash for that buy.");
  const note = `Bought ${token.symbol}.`;
  const booked = { ...next, bot: { ...next.bot, lastNote: `Grok agent bought ${token.symbol}` } };
  return {
    ok: true,
    status: 200,
    state: booked,
    book: bookOf(booked, command.account, note),
    fill: { action: "buy", symbol: token.symbol, usd, qty: opened.qty, price: opened.entryPrice },
  };
}

function queueLive(
  state: AppState,
  account: string | undefined,
  token: WatchToken,
  action: "buy" | "sell",
  usd?: number,
  price?: number,
): AgentReply {
  if (!state.bot.running) return fail(409, "Start the Sol bot before a Grok agent can send a real swap.");
  if (!state.bot.swapBot) return fail(409, "Arm the Sol desk before a Grok agent can send a real swap.");
  const order: AgentOrder = {
    id: id("agent-order"),
    action,
    symbol: token.symbol,
    mint: token.mint,
    ...(usd !== undefined ? { usd } : {}),
    ...(price !== undefined ? { price } : {}),
    at: new Date().toISOString(),
  };
  const note =
    action === "buy"
      ? `Queued a $${usd?.toFixed(2)} buy of ${token.symbol}. The next scan sends it through the trading key.`
      : `Queued a sell of ${token.symbol}. The next scan sends it through the trading key.`;
  const next: AppState = { ...state, bot: { ...state.bot, agentOrder: order, lastNote: note } };
  return {
    ok: true,
    status: 202,
    state: next,
    book: bookOf(next, account, note),
    fill: { action: "queued", symbol: token.symbol, ...(usd !== undefined ? { usd } : {}), ...(price !== undefined ? { price } : {}) },
  };
}
