import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData } from "viem";
import { CRO_TRADE_ROUTER, USDC, VVS_ROUTER, WCRO } from "./constants";
import { ULTCAT_MINT } from "@/lib/market/universe";
import { afterFee, buildCroTradeCall, cronosSwapPath, decideRoute } from "./route";

describe("Cronos routes", () => {
  it("sends CRO against USDC and memes through WCRO", () => {
    assert.deepEqual(cronosSwapPath(WCRO, "buy"), [USDC, WCRO]);
    assert.deepEqual(cronosSwapPath(WCRO, "sell"), [WCRO, USDC]);
    assert.deepEqual(cronosSwapPath(ULTCAT_MINT, "buy"), [USDC, WCRO, ULTCAT_MINT]);
    assert.deepEqual(cronosSwapPath(ULTCAT_MINT, "sell"), [ULTCAT_MINT, WCRO, USDC]);
  });

  it("picks the venue that returns more after cro.trade's fee", () => {
    assert.equal(decideRoute(1000n, 1000n)?.venue, "wolfswap");
    assert.equal(decideRoute(1000n, null)?.venue, "wolfswap");
    const croWins = decideRoute(900n, 1000n);
    assert.equal(croWins?.venue, "crotrade");
    assert.equal(croWins?.amountOut, afterFee(1000n, 90));
    assert.equal(decideRoute(null, null), null);
    assert.equal(decideRoute(0n, 0n), null);
  });

  it("builds a cro.trade call against the VVS router", () => {
    const call = buildCroTradeCall({
      amountIn: 1_000_000n,
      amountOutMin: 900n,
      path: [USDC, WCRO],
      deadline: 1_700_000_000n,
    });
    assert.equal(call.to, CRO_TRADE_ROUTER);
    assert.equal(call.value, 0n);
    const decoded = decodeFunctionData({
      abi: [
        {
          name: "swapExactTokensForTokens",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { name: "tokenIn", type: "address" },
            { name: "tokenOut", type: "address" },
            { name: "amountIn", type: "uint256" },
            { name: "amountOutMin", type: "uint256" },
            { name: "path", type: "address[]" },
            { name: "dexRouter", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
          outputs: [{ name: "amountOut", type: "uint256" }],
        },
      ],
      data: call.data,
    });
    assert.equal(decoded.functionName, "swapExactTokensForTokens");
    assert.equal(decoded.args[5].toLowerCase(), VVS_ROUTER.toLowerCase());
    assert.equal(decoded.args[2], 1_000_000n);
  });
});
