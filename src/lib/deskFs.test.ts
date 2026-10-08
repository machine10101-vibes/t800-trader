import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachDeskFiles, deskDataDir, fileKv } from "./deskFs";

describe("desk files", () => {
  it("defaults to ~/.t800-trader and honors T800_DATA", () => {
    const prior = process.env.T800_DATA;
    delete process.env.T800_DATA;
    assert.equal(deskDataDir(), path.join(os.homedir(), ".t800-trader"));
    process.env.T800_DATA = "/tmp/t800-data";
    assert.equal(deskDataDir(), "/tmp/t800-data");
    if (prior === undefined) delete process.env.T800_DATA;
    else process.env.T800_DATA = prior;
  });

  it("round-trips keys and books on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t800-desk-"));
    const files = attachDeskFiles(dir);
    files.keys.set("t800-trader-signer:So1", "[1,2]");
    files.store.set("t800-trader-state:solana:So1", "{\"ok\":true}");
    assert.equal(files.keys.get("t800-trader-signer:So1"), "[1,2]");
    assert.equal(fileKv(path.join(dir, "store.json")).get("t800-trader-state:solana:So1"), "{\"ok\":true}");
    files.store.remove?.("t800-trader-state:solana:So1");
    assert.equal(files.store.get("t800-trader-state:solana:So1"), null);
    assert.ok(files.keys.keys?.().includes("t800-trader-signer:So1"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
