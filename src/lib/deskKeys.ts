/** Controls that already handle the key, so global Space/F/R must not also fire. */
export const DESK_SHORTCUT_IGNORE =
  "input, textarea, select, button, a, [role='button'], [contenteditable='true']";

export function isDeskShortcutTarget(target: EventTarget | null): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  return typeof el?.closest === "function" && Boolean(el.closest(DESK_SHORTCUT_IGNORE));
}
