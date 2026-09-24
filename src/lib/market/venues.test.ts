import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeVenues, venueAllowed, venueForDex, venueSummary } from "./venues";

describe("venueForDex", () => {
  it("folds pool ids into the platforms a user can pick", () => {
    assert.equal(venueForDex("raydium"), "raydium");
    assert.equal(venueForDex("raydium-clmm"), "raydium");
    assert.equal(venueForDex("orca"), "orca");
    assert.equal(venueForDex("meteora-damm-v2"), "meteora");
    assert.equal(venueForDex("meteora-dbc"), "meteora");
    assert.equal(venueForDex("pumpswap"), "pump");
    assert.equal(venueForDex("pump-fun"), "pump");
    assert.equal(venueForDex("jupiter"), "jupiter");
    assert.equal(venueForDex("phoenix"), "other");
    assert.equal(venueForDex("manifest"), "other");
  });
});

describe("venueAllowed", () => {
  it("allows every venue when the book has not saved a choice", () => {
    assert.equal(venueAllowed("pumpswap", undefined), true);
  });

  it("blocks a pool whose platform is off", () => {
    assert.equal(venueAllowed("pumpswap", ["raydium", "orca"]), false);
    assert.equal(venueAllowed("raydium-clmm", ["raydium"]), true);
    assert.equal(venueAllowed("orca", []), false);
  });
});

describe("normalizeVenues", () => {
  it("fills every venue for an older book and keeps an explicit subset", () => {
    assert.equal(normalizeVenues(undefined).includes("raydium"), true);
    assert.equal(normalizeVenues(undefined).includes("pump"), true);
    assert.deepEqual(normalizeVenues(["orca", "nope", "orca"]), ["orca"]);
    assert.deepEqual(normalizeVenues([]), []);
  });

  it("summarizes the selection", () => {
    assert.equal(venueSummary(normalizeVenues(undefined)), "all venues");
    assert.equal(venueSummary(["orca", "raydium"]), "Raydium, Orca");
    assert.equal(venueSummary([]), "no venue");
  });
});
