const KEY = "t800-trader-live-session";

function stored(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let armed = stored();

export function isLiveSessionArmed(): boolean {
  return armed || stored();
}

export function armLiveSession(): void {
  armed = true;
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // Private mode still keeps the in-memory flag for this page.
  }
}

export function disarmLiveSession(): void {
  armed = false;
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // The in-memory flag is already cleared.
  }
}

/** A saved running LIVE book keeps sending after a refresh. */
export function resumeLiveSession(): void {
  armLiveSession();
}
