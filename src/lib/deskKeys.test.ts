import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DESK_SHORTCUT_IGNORE, isDeskShortcutTarget } from "./deskKeys";

function node(matches: string | null) {
  return {
    closest: (selector: string) => (selector === DESK_SHORTCUT_IGNORE && matches ? { tag: matches } : null),
  };
}

describe("desk shortcuts", () => {
  it("ignores keys already handled by a focused control", () => {
    assert.equal(isDeskShortcutTarget(null), false);
    assert.equal(isDeskShortcutTarget({} as EventTarget), false);
    assert.equal(isDeskShortcutTarget(node("button") as unknown as EventTarget), true);
    assert.equal(isDeskShortcutTarget(node("a") as unknown as EventTarget), true);
    assert.equal(isDeskShortcutTarget(node(null) as unknown as EventTarget), false);
  });
});
