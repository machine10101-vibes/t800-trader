/** Hidden-tab metronome. Closing the browser still needs `npm run desk`. */
export function deskTickWorkerUrl(pageHref: string): string {
  return new URL("desk-tick.js", pageHref).href;
}

export function startDeskKeepalive(onPulse: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  let wake: WakeLockSentinel | null = null;
  const lock = async () => {
    try {
      wake = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      // A rejected lock just means the laptop can still sleep.
    }
  };
  void lock();
  const onVis = () => {
    if (document.visibilityState === "visible") void lock();
  };
  document.addEventListener("visibilitychange", onVis);
  let worker: Worker | null = null;
  try {
    worker = new Worker(deskTickWorkerUrl(window.location.href));
    worker.onmessage = () => onPulse();
    worker.postMessage({ type: "arm", ms: 4_000 });
  } catch {
    worker = null;
  }
  return () => {
    document.removeEventListener("visibilitychange", onVis);
    void wake?.release().catch(() => undefined);
    worker?.postMessage({ type: "stop" });
    worker?.terminate();
  };
}
