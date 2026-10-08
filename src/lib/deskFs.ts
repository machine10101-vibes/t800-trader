import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { KeyBackend } from "@/lib/keystore";

/** Local files for the desk runner. Never imported by the browser bundle. */
export function deskDataDir(): string {
  const env = process.env.T800_DATA?.trim();
  return env && env.length > 0 ? env : path.join(os.homedir(), ".t800-trader");
}

export function fileKv(file: string): KeyBackend {
  const read = (): Record<string, string> => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed ?? {})) {
        if (typeof value === "string") out[key] = value;
      }
      return out;
    } catch {
      return {};
    }
  };
  const write = (map: Record<string, string>): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(map, null, 2));
  };
  return {
    get(key) {
      return read()[key] ?? null;
    },
    set(key, value) {
      const map = read();
      map[key] = value;
      write(map);
    },
    remove(key) {
      const map = read();
      delete map[key];
      write(map);
    },
    keys() {
      return Object.keys(read());
    },
  };
}

export function attachDeskFiles(dir = deskDataDir()): { keys: KeyBackend; store: KeyBackend } {
  fs.mkdirSync(dir, { recursive: true });
  return {
    keys: fileKv(path.join(dir, "keys.json")),
    store: fileKv(path.join(dir, "store.json")),
  };
}
