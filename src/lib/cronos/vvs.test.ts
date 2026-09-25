import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData } from "viem";
import { USDC, VVS_ROUTER, WCRO } from "./constants";
import { buildVvsCall, planCronosOpen, planVvsBuy, planVvsSell } from "./vvs";

const RECIPIENT = "0x1111111111111111111111111111111111111111" as const;

describe("VVS routing", () => {
  it("buys CRO with USDC on the VVS router", () => {
    const plan = planVvsBuy(12, 20, 4);
    assert.equal(plan.method, "swapExactTokensForETH");
    assert.equal(plan.amountIn, 12);
    assert.deepEqual(plan.path, [USDC, WCRO]);
    assert.equal(plan.approve, USDC);
    const call = buildVvsCall({
      method: plan.method,
      amountIn: 12_000_000n,
      amountOutMin: 1n,
      path: plan.path,
      recipient: RECIPIENT,
      deadline: 10n,
    });
    assert.equal(call.to, VVS_ROUTER);
    assert.equal(call.value, 0n);
    const decoded = decodeFunctionData({
      abi: [
        {
          name: "swapExactTokensForETH",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { name: "amountIn", type: "uint256" },
            { name: "amountOutMin", type: "uint256" },
            { name: "path", type: "address[]" },
            { name: "to", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
          outputs: [],
        },
      ],
      data: call.data,
    });
    assert.equal(decoded.functionName, "swapExactTokensForETH");
    const path = (decoded.args[2] as readonly string[]).map((item) => item.toLowerCase());
    assert.deepEqual(path, [USDC, WCRO]);
  });

  it("does not treat a CRO balance as a VVS buy", () => {
    assert.throws(() => planVvsBuy(12, 0, 200), /Buying CRO on VVS needs USDC/);
  });

  it("keeps a CRO-funded key as the long until a red tape sells it", () => {
    const held = planCronosOpen(12, 0, 200, 0.1);
    assert.equal(held.kind, "held");
    if (held.kind === "held") assert.ok(held.qty > 190);
    const bought = planCronosOpen(12, 20, 4, 0.1);
    assert.equal(bought.kind, "swap");
  });

  it("sells native CRO through the VVS router", () => {
    const plan = planVvsSell(3, 0);
    assert.equal(plan.method, "swapExactETHForTokens");
    assert.deepEqual(plan.path, [WCRO, USDC]);
    const call = buildVvsCall({
      method: plan.method,
      amountIn: 3n,
      amountOutMin: 1n,
      path: plan.path,
      recipient: RECIPIENT,
      deadline: 10n,
    });
    assert.equal(call.to, VVS_ROUTER);
    assert.equal(call.value, 3n);
  });

  it("sells wrapped CRO through the VVS router", () => {
    const plan = planVvsSell(1, 4);
    assert.equal(plan.method, "swapExactTokensForTokens");
    assert.equal(plan.approve, WCRO);
    assert.deepEqual(plan.path, [WCRO, USDC]);
    const call = buildVvsCall({
      method: plan.method,
      amountIn: 4n,
      amountOutMin: 1n,
      path: plan.path,
      recipient: RECIPIENT,
      deadline: 10n,
    });
    assert.equal(call.to, VVS_ROUTER);
    assert.equal(call.value, 0n);
  });
});
