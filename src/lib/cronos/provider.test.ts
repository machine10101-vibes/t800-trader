import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stringToHex } from "viem";
import {
  ARM_ALREADY_FUNDED,
  DISARM_RETURN,
  assertConnectedAccount,
  chooseSignProvider,
  cronosSendTx,
  labelCronosProvider,
  pickCronosProvider,
  requestPersonalSign,
  type CronosInjected,
} from "./provider";

const OWNER = "0x0000000000000000000000000000000000000001";
const BOT = "0x0000000000000000000000000000000000000002";

function wallet(flags: Partial<CronosInjected> = {}): CronosInjected {
  return { request: async () => "0x1", ...flags };
}

describe("Cronos wallet picker", () => {
  it("prefers the Onchain extension over MetaMask on window.ethereum", () => {
    const onchain = wallet({ isDeficonnectProvider: true });
    const metamask = wallet({ isMetaMask: true });
    const picked = pickCronosProvider({ ethereum: metamask, deficonnectProvider: onchain });
    assert.equal(picked, onchain);
    assert.equal(labelCronosProvider(picked), "Crypto.com Onchain");
    assert.equal(chooseSignProvider(picked, metamask), onchain);
  });

  it("uses deficonnect.ethereum, then a tagged provider inside the MetaMask list", () => {
    const nested = wallet({ isCryptoCom: true });
    const viaNamespace = pickCronosProvider({ deficonnect: { ethereum: wallet({ isDefiWallet: true }) } });
    assert.equal(labelCronosProvider(viaNamespace), "Crypto.com Onchain");
    const viaList = pickCronosProvider({
      ethereum: wallet({ isMetaMask: true, providers: [wallet({ isMetaMask: true }), nested] }),
    });
    assert.equal(viaList, nested);
  });

  it("falls back to whichever wallet owns window.ethereum", () => {
    const metamask = wallet({ isMetaMask: true });
    assert.equal(pickCronosProvider({ ethereum: metamask }), metamask);
    assert.equal(labelCronosProvider(metamask), "MetaMask");
    assert.equal(pickCronosProvider({}), null);
    assert.equal(labelCronosProvider(wallet()), "Ethereum wallet");
    assert.equal(chooseSignProvider(null, metamask), metamask);
  });

  it("asks for a personal_sign and retries the parameter order unless the user declined", async () => {
    const calls: unknown[][] = [];
    const provider = wallet({
      request: async (args) => {
        calls.push(args.params ?? []);
        if (calls.length === 1) throw new Error("Invalid parameters");
        return "0xabc";
      },
    });
    const signature = await requestPersonalSign(provider, OWNER, ARM_ALREADY_FUNDED);
    assert.equal(signature, "0xabc");
    assert.deepEqual(calls[0], [stringToHex(ARM_ALREADY_FUNDED), OWNER]);
    assert.deepEqual(calls[1], [OWNER, ARM_ALREADY_FUNDED]);

    const declined = wallet({
      request: async () => {
        throw Object.assign(new Error("User rejected the request"), { code: 4001 });
      },
    });
    await assert.rejects(() => requestPersonalSign(declined, OWNER, DISARM_RETURN), /rejected/i);
  });

  it("puts Cronos chain id on the funding transaction and refuses a switched account", () => {
    assert.deepEqual(cronosSendTx({ from: OWNER, to: BOT, value: 3n * 10n ** 18n }), {
      from: OWNER,
      to: BOT,
      chainId: "0x19",
      value: "0x29a2241af62c0000",
    });
    assert.equal(assertConnectedAccount(["0x0000000000000000000000000000000000000001"], OWNER), OWNER);
    assert.throws(
      () => assertConnectedAccount([BOT], OWNER),
      /Switch the Onchain wallet to the connected account/,
    );
  });
});
