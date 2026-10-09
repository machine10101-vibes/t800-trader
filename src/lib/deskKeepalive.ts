/** Hidden-tab metronome. Closing the browser still needs `npm run desk`. */
export function deskTickWorkerUrl(pageHref: string): string {
  const page = new URL(pageHref);
  if (!page.pathname.endsWith("/")) {
    const leaf = page.pathname.split("/").pop() ?? "";
    if (!leaf.includes(".")) page.pathname += "/";
    else page.pathname = page.pathname.slice(0, page.pathname.lastIndexOf("/") + 1);
  }
  return new URL("desk-tick.js", page).href;
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
    if (document.visibilityState !== "visible") return;
    void lock();
    onPulse();
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pageshow", onVis);
  let worker: Worker | null = null;
  try {
    worker = new Worker(deskTickWorkerUrl(window.location.href));
    worker.onmessage = () => onPulse();
    worker.postMessage({ type: "arm", ms: 4_000 });
  } catch {
    worker = null;
  }
  const fallback = worker ? 0 : window.setInterval(onPulse, 4_000);
  return () => {
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pageshow", onVis);
    void wake?.release().catch(() => undefined);
    if (fallback) window.clearInterval(fallback);
    worker?.postMessage({ type: "stop" });
    worker?.terminate();
  };
}
