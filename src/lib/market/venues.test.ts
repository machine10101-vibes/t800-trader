import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cronosVenueFlags,
  cronosVenuesOn,
  normalizeVenues,
  venueAllowed,
  venueForDex,
  venueOptionsFor,
  venueSummary,
} from "./venues";

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
    assert.equal(venueForDex("vvs"), "vvs");
    assert.equal(venueForDex("wolfswap"), "wolfswap");
    assert.equal(venueForDex("cro.trade"), "crotrade");
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
    assert.deepEqual(normalizeVenues(["vvs", "wolfswap", "nope"]), ["vvs", "wolfswap"]);
    assert.deepEqual(normalizeVenues([]), []);
  });

  it("summarizes the selection", () => {
    assert.equal(venueSummary(normalizeVenues(undefined)), "all venues");
    assert.equal(venueSummary(["orca", "raydium"]), "Raydium, Orca");
    assert.equal(venueSummary([]), "no venue");
    assert.equal(venueSummary(["wolfswap", "vvs", "crotrade"], "cronos"), "all venues");
    assert.equal(venueSummary(["vvs"], "cronos"), "VVS Finance");
    assert.equal(venueSummary(["raydium", "orca"], "cronos"), "all venues");
    assert.equal(venueSummary([], "cronos"), "no venue");
  });

  it("treats a saved Solana venue list as every Cronos DEX on", () => {
    assert.deepEqual(cronosVenuesOn(["raydium", "orca"]), ["wolfswap", "vvs", "crotrade"]);
    assert.deepEqual(cronosVenuesOn(["vvs"]), ["vvs"]);
    assert.deepEqual(cronosVenuesOn([]), []);
    assert.deepEqual(cronosVenueFlags(["crotrade"]), { wolfswap: false, vvs: false, crotrade: true });
  });

  it("lists Solana DEXes on Solana and Cronos DEXes on Cronos", () => {
    assert.deepEqual(
      venueOptionsFor("solana").map((row) => row.id),
      ["raydium", "orca", "meteora", "jupiter", "pump", "other"],
    );
    assert.deepEqual(
      venueOptionsFor("cronos").map((row) => row.id),
      ["wolfswap", "vvs", "crotrade"],
    );
  });
});
