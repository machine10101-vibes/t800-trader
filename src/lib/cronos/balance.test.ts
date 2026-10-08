import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chainIsCronos,
  collectEvmAccounts,
  collectPosAccounts,
  croHoldings,
  croPosToEvm,
  evmToCroPos,
  formatCro,
  formatCroEvm,
  mergeCronosRefresh,
  mergeNativeBalance,
  orderCronosAccounts,
  parseRpcQuantity,
  pickEvmNative,
  preferFundedAccount,
} from "./balance";

const FUNDED = "0x0000000000000000000000000000000000000001";
const EMPTY = "0x0000000000000000000000000000000000000002";

describe("Cronos balance", () => {
  it("keeps the larger native balance and prices wrapped CRO with it", () => {
    assert.equal(mergeNativeBalance([0, null, 4.5, 1]), 4.5);
    const held = croHoldings({ sol: 0, wcro: 12, usdc: 1, solPriceUsd: null }, 0.05);
    assert.equal(held.cro, 12);
    assert.equal(held.usd, 1.6);
    assert.equal(croHoldings({ sol: 2, usdc: 0, solPriceUsd: 0.1 }).usd, 0.2);
    const posOnly = croHoldings({ sol: 0, posCro: 40, usdc: 0, solPriceUsd: 0.05 });
    assert.equal(posOnly.cro, 0);
    assert.equal(posOnly.evm, 0);
    assert.equal(posOnly.pos, 40);
    assert.equal(posOnly.onPos, true);
    assert.equal(posOnly.usd, 0);
    const evmAndPos = croHoldings({ sol: 3.2, posCro: 200, usdc: 0, solPriceUsd: 0.1 });
    assert.equal(evmAndPos.cro, 3.2);
    assert.equal(evmAndPos.onPos, false);
    assert.equal(Number(evmAndPos.usd.toFixed(2)), 0.32);
    assert.equal(formatCroEvm(0), "0 CRO EVM");
    assert.equal(formatCroEvm(3.2), "3.200 CRO EVM");
    assert.equal(pickEvmNative({ rpc: 0, wallet: 206.135, viem: 0, posCro: 206.135 }), 0);
    assert.equal(pickEvmNative({ rpc: 3.1, wallet: 206.135, viem: 3.1, posCro: 206.135 }), 3.1);
    assert.equal(pickEvmNative({ wallet: 206.135, posCro: 206.135 }), 0);
    assert.equal(pickEvmNative({ wallet: 8, posCro: 0 }), 8);
    const kept = mergeCronosRefresh(
      {
        address: FUNDED,
        sol: 206.135,
        wcro: 0,
        usdc: 0,
        posCro: 206.135,
        solPriceUsd: 0.06,
        equityUsd: 12,
      },
      {
        address: FUNDED,
        sol: 0,
        wcro: 0,
        usdc: 0,
        posCro: 206.135,
        solPriceUsd: 0.06,
        equityUsd: 0,
      },
    );
    assert.equal(kept.sol, 0);
    assert.equal(kept.posCro, 206.135);
  });

  it("recognizes Cronos even when the wallet returns a number or a padded chain id", () => {
    assert.equal(chainIsCronos("0x19"), true);
    assert.equal(chainIsCronos(25), true);
    assert.equal(chainIsCronos("0x0000000000000000000000000000000000000019"), true);
    assert.equal(chainIsCronos("0x1"), false);
    assert.equal(chainIsCronos(1), false);
  });

  it("does not treat a single address string as its first character", () => {
    assert.deepEqual(orderCronosAccounts(FUNDED), [FUNDED]);
    assert.deepEqual(orderCronosAccounts([{ address: FUNDED }]), [FUNDED]);
    assert.deepEqual(orderCronosAccounts([EMPTY, FUNDED], FUNDED), [FUNDED, EMPTY]);
  });

  it("uses the funded account when the selected one is empty", () => {
    const picked = preferFundedAccount([
      { account: EMPTY, bal: { sol: 0, wcro: 0, usdc: 0 } },
      { account: FUNDED, bal: { sol: 0, wcro: 8, usdc: 0 } },
    ]);
    assert.equal(picked, FUNDED);
    assert.equal(formatCro(0), "0 CRO");
    assert.equal(formatCro(15), "15.000 CRO");
    assert.equal(formatCro(0.0001), "0.000100 CRO");
    const dustFirst = preferFundedAccount([
      { account: EMPTY, bal: { sol: 0.0001, wcro: 0, usdc: 0 } },
      { account: FUNDED, bal: { sol: 40, wcro: 0, usdc: 0 } },
    ]);
    assert.equal(dustFirst, FUNDED);
    const posOverDust = preferFundedAccount([
      { account: EMPTY, bal: { sol: 0.0001, wcro: 0, usdc: 0, posCro: 0 } },
      { account: FUNDED, bal: { sol: 0, wcro: 0, usdc: 0, posCro: 200 } },
    ]);
    assert.equal(posOverDust, FUNDED);
  });

  it("pulls every 0x and cro1 address out of the Onchain account payload", () => {
    const packed = {
      accounts: [{ address: EMPTY }, { evmAddress: FUNDED }, { bech32Address: "cro1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpkwunx7" }],
    };
    assert.deepEqual(collectEvmAccounts(packed), [EMPTY, FUNDED]);
    assert.deepEqual(collectPosAccounts(packed), ["cro1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpkwunx7"]);
    assert.equal(parseRpcQuantity({ jsonrpc: "2.0", result: "0xde0b6b3a7640000" }), 10n ** 18n);
  });

  it("turns a Cronos POS address into the matching EVM account", () => {
    assert.equal(croPosToEvm("not-an-address"), null);
    assert.equal(croPosToEvm("cro1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpkwunx7"), FUNDED);
    assert.equal(evmToCroPos(FUNDED), "cro1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpkwunx7");
    assert.equal(croPosToEvm(evmToCroPos(FUNDED) ?? ""), FUNDED);
  });
});
