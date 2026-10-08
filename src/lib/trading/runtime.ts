/** How long to wait before the next scan. Live open tickets check a bit sooner. */
export function nextTickWaitMs(opts: {
  scanSeconds: number;
  openLivePosition?: boolean;
  usedMs?: number;
}): number {
  const configured = Math.max(4, opts.scanSeconds) * 1000;
  const target = opts.openLivePosition ? Math.min(configured, 4_000) : configured;
  return Math.max(1_000, target - Math.max(0, opts.usedMs ?? 0));
}

export const DESK_RUNNER_PORT = 8787;
export const DESK_RUNNER_HOST = "127.0.0.1";

export function localRunnerOrigin(port = DESK_RUNNER_PORT): string {
  return `http://${DESK_RUNNER_HOST}:${port}`;
}

export function runnerStatusUrl(origin = ""): string {
  return `${origin}/api/desk/status`;
}

export function runnerBookUrl(chain: string, origin = ""): string {
  return `${origin}/api/desk/${chain}`;
}

export function isDeskApiPath(pathname: string): boolean {
  return pathname === "/api/desk/status" || pathname === "/api/desk/keys" || /^\/api\/desk\/(solana|cronos)$/.test(pathname);
}
