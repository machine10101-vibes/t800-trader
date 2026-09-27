let armed = false;

export function isLiveSessionArmed(): boolean {
  return armed;
}

export function armLiveSession(): void {
  armed = true;
}

export function disarmLiveSession(): void {
  armed = false;
}
