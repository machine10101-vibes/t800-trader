const KEY = "t800-trader-live-session";

function flagFrom(storage: Storage | undefined): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function stored(): boolean {
  const local = typeof localStorage !== "undefined" ? localStorage : undefined;
  const session = typeof sessionStorage !== "undefined" ? sessionStorage : undefined;
  return flagFrom(local) || flagFrom(session);
}

function writeFlag(on: boolean): void {
  for (const storage of [
    typeof localStorage !== "undefined" ? localStorage : null,
    typeof sessionStorage !== "undefined" ? sessionStorage : null,
  ]) {
    if (!storage) continue;
    try {
      if (on) storage.setItem(KEY, "1");
      else storage.removeItem(KEY);
    } catch {
      // Private mode still keeps the in-memory flag for this page.
    }
  }
}

let armed = stored();

export function isLiveSessionArmed(): boolean {
  return armed || stored();
}

export function armLiveSession(): void {
  armed = true;
  writeFlag(true);
}

export function disarmLiveSession(): void {
  armed = false;
  writeFlag(false);
}

/** A saved running LIVE book keeps sending after a refresh or a later visit. */
export function resumeLiveSession(): void {
  armLiveSession();
}
