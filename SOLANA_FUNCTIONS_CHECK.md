# Solana functions check — T-800 Trader

Date: 2026-09-27  
Scope: Solana path only. This repository has **no Cronos modules, routes, or config**. Cronos is noted here only to record that it is absent.

## What this repo actually is

T-800 is a **static Next.js (GitHub Pages) research desk** with an in-browser **paper** book. It is not a custody bot, not a Jupiter/Raydium swapper, and it does not place on-chain orders.

| Expected live-trader capability | Present? |
| --- | --- |
| Injected Phantom / Solflare connect | Yes (`src/lib/solana/wallet.ts`) |
| Read-only SOL + USDC balances via public RPC | Yes |
| Universe / regime / 5m signals | Yes (GeckoTerminal + CoinGecko + DefiLlama + Alternative.me) |
| Paper buy / sell / marks / risk limits | Yes (`src/lib/trading/*`) |
| Dry-run / paper mode | **This is the only mode** |
| Live swap / quote / Jupiter / priority fees | **No — not implemented** |
| Seed phrase / keypair / secret env | **No — must stay that way** |
| Cronos | **No code** |

There is no Node API, no CLI trade command, and no `process.env` secret. Optional env (build-time only):

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SOLANA_RPC` | No | Prepend a custom read-only JSON-RPC. Defaults: `https://solana.publicnode.com`, `https://solana-rpc.publicnode.com` |

## Map

```
src/app/page.tsx          → DeskApp (only UI entry)
src/lib/client.ts         → loadDesk / controlBot / configureBot
src/lib/desk.ts           → buildDesk
src/lib/store.ts          → wallet-scoped localStorage paper book
src/lib/solana/wallet.ts  → injected wallet + RPC balances / health
src/lib/market/*          → Solana universe + public market feeds
src/lib/research/*        → screen / score / thesis
src/lib/trading/*         → paper execution, risk, signals, tick loop
```

Entrypoints: `npm run dev` (Next on `:3000`, base path `/t800-trader/`), `npm test`, `npm run build` (static `out/`).

## Checklist

Status after the checks in this PR. `SKIPPED` means the path cannot run here without a browser wallet or would require live funds / secrets — which this review will not do.

| Function | Module | Result | Notes |
| --- | --- | --- | --- |
| `walletInstalled` | `solana/wallet.ts` | PASS | False in Node (no injected provider) |
| `connectWallet` | `solana/wallet.ts` | PASS (gate) / SKIPPED (browser approve) | Throws without Phantom/Solflare. Live approve not exercised |
| `disconnectWallet` | `solana/wallet.ts` | PASS | No-op without provider |
| `solanaRpcs` | `solana/wallet.ts` | PASS | PublicNode defaults + optional override |
| `associatedUsdcAddress` | `solana/wallet.ts` | PASS | Classic Token program ATA (not Token-2022) |
| `readBalances` (mock) | `solana/wallet.ts` | PASS | SOL lamports + parsed USDC + CoinGecko mark |
| `readBalances` (live read-only) | `solana/wallet.ts` | PASS or SKIPPED | Well-known WSOL mint; no keys |
| `pingSolanaRpc` | `solana/wallet.ts` | PASS or SKIPPED | `getHealth` on PublicNode |
| `attachWallet` / `detachWallet` / `loadState` | `store.ts` | PASS | Book is refused until a wallet is attached |
| `emptyState` | `store.ts` | PASS | Starting equity is `0`, not a $10k demo |
| `mutateState` | `store.ts` | PASS | In-memory when `window` is absent |
| `applyControl` start/stop/reset | `trading/bot.ts` | PASS | Pure paper control |
| `tickBot` without wallet | `trading/bot.ts` | PASS | Throws “Connect a Solana wallet…” |
| `tickBot` paper tick + live feeds | `trading/bot.ts` | PASS or SKIPPED | No transaction is sent |
| `fillPrice` / `openPosition` / `closePosition` | `trading/paper.ts` | PASS | Long and short cash now stay consistent |
| `markBook` / `pushEquity` | `trading/paper.ts` | PASS | Short marks add PnL instead of subtracting it |
| `sizePosition` / `canOpen` / `dayLossBreached` | `trading/risk.ts` | PASS | Existing unit tests |
| `exitReason` long + short trail | `trading/risk.ts` | PASS | Short trail used the adverse wick before this PR |
| `ema` / `rsi` / `snapshotTechnical` / `buildSignals` | `trading/signals.ts` | PASS | Signals are paper tickets only |
| `screenCandidate` / `scoreCandidate` | `research/scoring.ts` | PASS | Existing unit tests |
| `runResearch` / `wrongAbout` | `research/engine.ts` | PASS (indirect) | Exercised by `tickBot` + `loadMarket` |
| `WATCHLIST` / mint constants | `market/universe.ts` | PASS | All mints valid after ORCA mint correction |
| `loadMarket` | `market/providers.ts` | PASS | Live universe this run: Solana-only candidates, no API key |
| `fetchOhlcv` | `market/providers.ts` | SKIPPED (this run) | GeckoTerminal `429` on a follow-up OHLCV pull after `loadMarket` |
| `loadDesk` / `controlBot` / `configureBot` | `client.ts` | PASS (indirect) | Thin wrappers over store + desk + bot |
| `buildDesk` | `desk.ts` | PASS (indirect) | Requires attached wallet + feeds |
| Live Jupiter quote | — | SKIPPED | Not implemented |
| Live swap / buy / sell on-chain | — | SKIPPED | Not implemented; paper only |
| Token-2022 USDC balance | `solana/wallet.ts` | SKIPPED | Mainnet USDC mint is still classic Token program |
| Phantom/Solflare UI connect | `DeskApp.tsx` | SKIPPED | Needs a browser extension on this origin |
| Cronos | — | SKIPPED | No Cronos code in this repo |

## Broken / missing (found, not assumed)

1. **Short paper accounting was wrong.** `markBook` added `qty * mark` for shorts, so a winning short *reduced* equity. `closePosition` returned `qty * close` instead of collateral + PnL, so a profitable short drained cash. Fixed: shorts use `qty * entry + unrealizedPnl`.
2. **Short trail exit used `lowWater` (adverse high) instead of `highWater` (favorable low).** A clean winning short almost never trailed. Fixed to match the long-side lock logic.
3. **RPC had no timeout.** A hung PublicNode POST could stall wallet connect forever. Added a 10s abort per endpoint and kept failover.
4. **RPC endpoints were hardcoded** with no override. Added optional `NEXT_PUBLIC_SOLANA_RPC` (documented in `.env.example`). Still no secrets.
5. **README said the default book was $10,000.** The UI and `DEFAULT_CONFIG.startingEquity = 0` size the book from the connected wallet. README updated.
6. **No tests covered wallet, paper book, store, universe, or live read-only RPC.** Added mock-safe unit tests plus skippable live smokes.
7. **ORCA watchlist mint was not a valid public key** (`orcaEKTdK7LKz57vaA7iQxNhMvpvA2aP8VDgQ1sVR8`, 42 chars). Dedicated GeckoTerminal token-pool fetches and `watchMeta` matches for Orca could never succeed. Replaced with the official mint `orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE`.
8. **Watchlist pool fetch uses `WATCHLIST.slice(0, 12)`.** BONK, WIF, and JLP do not get a dedicated GeckoTerminal token-pool pull (they can still appear in trending/volume). Left as-is to avoid extra public API load; documented, not changed.
9. **`@solana/web3.js` is used only for `PublicKey` + ATA PDA.** Heavy but valid. No broken import.
10. **Public RPCs are assumed CORS-ok in the browser.** Node smokes cannot prove GitHub Pages CORS. If a wallet connect fails in production after approve, the next place to look is PublicNode CORS or rate limit — then set `NEXT_PUBLIC_SOLANA_RPC`.
11. **No live swap stack.** If the goal was an on-chain Solana trader, that entire layer (quote, swap, priority fees, tx send, confirmation) is missing by design. This review does not add it.

## Unsafe defaults (accepted vs fixed)

| Default | Verdict |
| --- | --- |
| Paper-only fills, 8 bps slip | Accepted — honest vs live MEV/impact (called out in UI copy) |
| PublicNode RPC | Accepted for a static site; now overridable + timed out |
| `allowShorts: true` | Accepted, but shorts were economically wrong until this PR |
| `allowMemes: true` | Accepted — screen still drops thin / wrapped / young books |
| Wallet required to arm | Accepted — no dummy $10k book |
| No private-key env | Correct — do not add |

## How to re-run

```bash
npm install
npm test
npm run build
```

Live smokes hit public Solana RPC and GeckoTerminal only. They skip on timeout/429 instead of inventing credentials.

### Last local run (this PR)

```
# tests 38
# pass 37
# fail 0
# skipped 1   (fetchOhlcv 429 Too Many Requests)
```

`pingSolanaRpc` → PublicNode `getHealth` = `ok`.  
`readBalances` on the WSOL mint succeeded (read-only).  
`tickBot` completed a paper tick against live Solana feeds with no transaction sent.

## Cronos

No Cronos sources, scripts, or env. Nothing was modified or tested on Cronos.
