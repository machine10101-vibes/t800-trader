import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { SOL_MINT } from "@/lib/market/universe";
import type { RestingQuote } from "@/lib/types";
import { planMakerBuy, readTriggerOrder, type MakerDesk, type MakerPlace } from "@/lib/trading/quote";
import { tradingKeypair } from "./authorize";
import { mintDecimals, readBalances, type WalletSession } from "./wallet";

const TRIGGER = "https://lite-api.jup.ag/trigger/v1";

interface TriggerBody {
  code?: number | string;
  error?: string;
  message?: string;
  order?: string;
  requestId?: string;
  transaction?: string;
  signature?: string;
}

interface ListedOrder {
  orderKey?: string;
  status?: string;
  rawTakingAmount?: string;
  closeTx?: string;
  trades?: { action?: string; txId?: string; rawOutputAmount?: string }[];
}

async function trigger<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${TRIGGER}${path}`, {
    method,
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T & TriggerBody;
  if (!res.ok || json.error) throw new Error(json.error || json.message || `${res.status} from Jupiter limit orders`);
  return json;
}

function decodeTx(b64: string): VersionedTransaction {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return VersionedTransaction.deserialize(bytes);
}

function encodeTx(tx: VersionedTransaction): string {
  const bytes = tx.serialize();
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

async function signAndExecute(b64: string, requestId: string, key: Keypair): Promise<string> {
  const tx = decodeTx(b64);
  tx.sign([key]);
  const result = await trigger<TriggerBody>("/execute", "POST", {
    signedTransaction: encodeTx(tx),
    requestId,
  });
  if (!result.signature) throw new Error("Jupiter did not return a signature for this limit order.");
  return result.signature;
}

async function listOrders(user: string, orderStatus: "active" | "history"): Promise<ListedOrder[]> {
  const json = await trigger<{ orders?: ListedOrder[] }>(
    `/getTriggerOrders?user=${encodeURIComponent(user)}&orderStatus=${orderStatus}`,
    "GET",
  );
  return json.orders ?? [];
}

export function makerDesk(session: WalletSession): MakerDesk {
  const signer = () => {
    const key = tradingKeypair(session.address);
    if (!key) throw new Error("Arm the bot before a limit bid can be sent.");
    return key;
  };

  return {
    async place(order: MakerPlace) {
      const key = signer();
      const trader = key.publicKey.toBase58();
      const balances = await readBalances(trader);
      const outputDecimals = order.mint === SOL_MINT ? 9 : await mintDecimals(order.mint);
      const plan = planMakerBuy({
        mint: order.mint,
        mid: order.mid,
        notionalUsd: order.notionalUsd,
        usdc: balances.usdc,
        sol: balances.sol,
        solPriceUsd: balances.solPriceUsd ?? 0,
        outputDecimals,
      });
      const created = await trigger<TriggerBody>("/createOrder", "POST", {
        inputMint: plan.inputMint,
        outputMint: plan.outputMint,
        maker: trader,
        payer: trader,
        params: { makingAmount: plan.makingAmount, takingAmount: plan.takingAmount },
        computeUnitPrice: "auto",
      });
      if (!created.transaction || !created.requestId || !created.order) {
        throw new Error("Jupiter did not return a limit-order transaction.");
      }
      const signature = await signAndExecute(created.transaction, created.requestId, key);
      return { orderKey: created.order, signature, limitPrice: plan.limitPrice, outputDecimals };
    },

    async cancel(orderKey: string) {
      const key = signer();
      const created = await trigger<TriggerBody>("/cancelOrder", "POST", {
        maker: key.publicKey.toBase58(),
        order: orderKey,
        computeUnitPrice: "auto",
      });
      if (!created.transaction || !created.requestId) throw new Error("Jupiter did not return a cancel transaction.");
      await signAndExecute(created.transaction, created.requestId, key);
    },

    async lookup(quote: RestingQuote) {
      const key = signer();
      const user = key.publicKey.toBase58();
      const active = await listOrders(user, "active");
      const live = active.find((row) => row.orderKey === quote.orderKey);
      if (live) return readTriggerOrder(live, quote.limitPrice, quote.outputDecimals);
      const history = await listOrders(user, "history");
      const past = history.find((row) => row.orderKey === quote.orderKey);
      if (!past) return "gone";
      return readTriggerOrder(past, quote.limitPrice, quote.outputDecimals);
    },
  };
}
