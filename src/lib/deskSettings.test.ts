import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commitTicketCap, nextSettingsDraft } from "./deskSettings";
import { DEFAULT_CONFIG, normalizeConfig } from "./store";

describe("settings draft", () => {
  it("keeps a $5 ticket cap while the saved book is still $250", () => {
    const saved = normalizeConfig(DEFAULT_CONFIG);
    const draft = normalizeConfig({ ...saved, maxLiveNotionalUsd: 5 });
    assert.equal(saved.maxLiveNotionalUsd, 250);
    assert.equal(draft.maxLiveNotionalUsd, 5);
    assert.equal(nextSettingsDraft(draft, saved, true).maxLiveNotionalUsd, 5);
  });

  it("follows the book again after the edit is saved", () => {
    const saved = normalizeConfig({ ...DEFAULT_CONFIG, maxLiveNotionalUsd: 5 });
    const draft = normalizeConfig({ ...DEFAULT_CONFIG, maxLiveNotionalUsd: 5 });
    assert.equal(nextSettingsDraft(draft, saved, false).maxLiveNotionalUsd, 5);
  });

  it("keeps a typed $5 cap and clamps anything outside $5–$10000", () => {
    assert.equal(commitTicketCap("5", 250), 5);
    assert.equal(commitTicketCap("5.4", 250), 5.4);
    assert.equal(commitTicketCap("", 250), 250);
    assert.equal(commitTicketCap("nope", 250), 250);
    assert.equal(commitTicketCap("1", 250), 5);
    assert.equal(commitTicketCap("99999", 250), 10_000);
  });
});