import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { armButton, shellDesk } from "./desk";
import { emptyState } from "./store";

describe("armButton", () => {
  it("disarms when the book is already running", () => {
    assert.deepEqual(armButton(true), { action: "stop", label: "Disarm the bot" });
    assert.deepEqual(armButton(false), { action: "start", label: "Arm the bot" });
  });
});

describe("shellDesk", () => {
  it("shows a saved armed book as armed and leaves a fresh book disarmed", () => {
    const armed = emptyState();
    armed.bot.running = true;
    armed.bot.lastNote = "Armed — first tick incoming";
    const shell = shellDesk(armed);
    assert.equal(shell.bot.running, true);
    assert.equal(shell.bot.lastNote, "Armed — first tick incoming");
    assert.equal(shell.research.length, 0);
    assert.equal(shell.regime.sol.price, 0);
    assert.equal(shell.portfolio, armed.portfolio);

    const fresh = shellDesk(emptyState());
    assert.equal(fresh.bot.running, false);
  });
});
