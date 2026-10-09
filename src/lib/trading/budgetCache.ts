import type { ChainId } from "@/lib/chain";
import type { WalletBudget } from "@/lib/trading/risk";

/** Skip another RPC read while the last one is still this fresh. */
export const BUDGET_FRESH_MS = 20_000;
/** A stale read is still better than treating the trading key as unread. */
export const BUDGET_STALE_MS = 10 * 60_000;

interface Entry {
  at: number;
  budget: WalletBudget;
}

const cache = new Map<string, Entry>();

export function budgetCacheKey(chain: ChainId, address: string): string {
  return `${chain}:${address.toLowerCase()}`;
}

export function rememberBudget(chain: ChainId, address: string, budget: WalletBudget): WalletBudget {
  const copy: WalletBudget = {
    usdc: budget.usdc,
    sol: budget.sol,
    solPriceUsd: budget.solPriceUsd,
    ...(budget.wcro != null ? { wcro: budget.wcro } : {}),
  };
  cache.set(budgetCacheKey(chain, address), { at: Date.now(), budget: copy });
  return copy;
}

export function recallBudget(chain: ChainId, address: string, maxAgeMs = BUDGET_STALE_MS): WalletBudget | null {
  const row = cache.get(budgetCacheKey(chain, address));
  if (!row) return null;
  if (Date.now() - row.at > maxAgeMs) return null;
  return { ...row.budget };
}

export function freshBudget(chain: ChainId, address: string): WalletBudget | null {
  return recallBudget(chain, address, BUDGET_FRESH_MS);
}

export function clearBudgetCache(): void {
  cache.clear();
}
