# T-800 Trader

Solana-first research desk. **PAPER** is the default. Opt-in **LIVE** Jupiter swaps (trading key + Ultra-sponsored closes) after you type `LIVE` this session.

Play it at **https://machine10101-vibes.github.io/t800-trader/**

Connect a real **Phantom** or **Solflare** wallet to arm the desk. There is no demo book and no $10,000 fallback. The book is sized from the wallet’s live SOL + USDC.

The desk does not start from a celebrity coin list. It pulls a live Solana universe (watchlist venues plus trending, new, and high-volume pools), throws out thin or obviously adversarial tape, then keeps 5–8 finalists. A separate execution loop only trades names that survived that screen, and only when 5-minute structure, volume, and risk limits agree.

This is a research tool. It is **not** financial advice. LIVE can lose real USDC and SOL. See [LIVE_TRADING.md](LIVE_TRADING.md).

The published site is a **static** Next.js export (`output: 'export'`, `basePath` / `assetPrefix` `/t800-trader`). Overview, Radar, thesis drawer, Arm, Book, and Options all run in the browser. Book state lives in `localStorage`. There is no Node server and no `data/state.json` on GitHub Pages.

## What you get

- **Home (Solana)** — the one screen most people need. It has a Practice / Real money switch, a big Start / Stop button, and one plain sentence saying what the bot is doing. **What the bot is doing** shows only the current status: a trade waiting for its profit goal, a limit that stopped new trades, or a wall when a check is stuck. If none of those is happening, the sentence is the whole section. It shows your balance, today, all closed trades and wins. Each open trade has a bar from its safety stop to its goal and a Sell now button. Recent results and the bot's rules are listed in plain words, written from your live settings. Charts, Coins, Bot log, History and Settings hold the detail.

- **Overview** — BTC / ETH / SOL regime, dominance, Fear & Greed, Solana TVL, Solana DEX volume, crowded vs overlooked tape
- **Radar** — comparison table (asset, ticker, price, market cap, FDV, sector, thesis, catalyst, risk, key metric, score)
- **Thesis drawer** — core thesis, mispricing argument, fundamental and tape evidence, tokenomics gaps, valuation, competition, dated catalyst windows, bull / base / bear, invalidation, monitors, sources
- **Bot** — arm / disarm, force tick, live signals (breakout, RSI reclaim, climax fade)
- **Book** — paper equity, open positions, tickets
- **Risk** — per-trade risk, daily loss cap, max positions, liquidity floor, shorts / memes toggles

## How the bot thinks

1. **Regime** from CoinGecko, Alternative.me, and DefiLlama
2. **Universe** from GeckoTerminal Solana pools + a conservative watchlist (JUP, JTO, RAY, Drift, Pyth, …)
3. **Screen** — liquidity, 24h volume, pool age, quote asset, optional meme ban
4. **Score** — organic flow, valuation hygiene, activity, venue risk, 5m technicals
5. **Trade** — PAPER simulates fills. LIVE arms a trading key, then Jupiter sends the swap. Stop / target / trail / time exits.
6. **Skeptic pass** — missing unlocks, revenue, and holder data are listed, never invented

Default book: the connected wallet’s live SOL + USDC mark (no $10,000 dummy). A **$5** wallet is enough to open. Max 4 positions. ~1.1% equity risk per trade, cut in defensive regimes. Daily loss cap 6%. Micro books ($5–$50) put most of the cash to work so a $5–$6 wallet can actually fill.

## Solana strategy and replay results

A Solana winner is not sold until the gain is larger than the fee to open the trade and the fee to close it. A stop still sells a loser. Solana books trade the 4-hour setups only. The defaults are a 4% stop, an 8% target, a 4-hour stale exit and a 6-hour time cap. Early fade/scratch sells are off, and 5x/10x are off. All of these are still in Settings. Older Solana books move to these defaults once. Your own size cap, slippage and mode are kept.

Shorts use those same 4-hour setups turned over: a breakdown through the prior low, an extreme RSI reject, a watchlist continuation that has real volume, and a VWAP reject. The stop and the target are the same distances, with the stop above the fill and the goal below it. Practice can short every name on the book. A real-money short is SOL only, sent as a Jupiter perpetual. Other live names stay spot buys and sells.

`scripts/backtest.ts` replays the real bot functions one scan per minute. It uses Binance minute bars for SOL, PUMP, ZEC and RAY, BTC for the regime, and Fear & Greed. Fees are charged per side on top of the paper slip: 3 bps for SOL spot, 7 bps for SOL perps, and 20 bps for the other tokens. Fetch the data with `npx tsx scripts/fetch-candles.ts 120`, then run `npx tsx scripts/backtest.ts --days 89 --holdout 30`.

| Setup, $200 book | 89-day tuning window | 30-day holdout |
| --- | --- | --- |
| Previous defaults (15m flow entries, fade exit, 5x/10x) | −98.5% | −84.6% |
| Current Solana defaults, longs only | −0.9%, max drawdown 3.2% | −1.3%, max drawdown 3.2% |
| Same defaults with mirrored shorts | −1.4%, max drawdown 5.0% | −2.4%, max drawdown 3.6% |

No configuration tested was profitable after fees in both windows. Mirrored shorts use the same setups as the longs. On this replay they added a small loss. They did not produce a profit in either window. **There is no edge here that guarantees profit.** Treat LIVE as an experiment sized to money you can lose.

The replay also found a deadlock. After three straight losses, new entries were blocked forever, because only a win resets the streak. The pause now lifts an hour after the last loss.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000/t800-trader/](http://localhost:3000/t800-trader/). The `/t800-trader` base path matches GitHub Pages. Connect a wallet, then press **Space** to arm or disarm the bot.

```bash
npm test
npm run build
```

`next build` writes a static export to `out/` (project Pages layout: `basePath` / `assetPrefix` `/t800-trader`). Paper state is stored in the browser. Reset it from the Risk tab.

## Data sources

| Feed | Use |
| --- | --- |
| [CoinGecko](https://www.coingecko.com) | BTC / ETH / SOL price, dominance, global cap |
| [Alternative.me](https://alternative.me/crypto/fear-and-greed-index/) | Fear & Greed |
| [DefiLlama](https://defillama.com) | Solana TVL and DEX volume |
| [GeckoTerminal](https://www.geckoterminal.com) | Solana pools, flow, OHLCV |

No API keys required for the public endpoints above. Rate limits apply. On Pages the browser calls these feeds directly, so a blocked or rate-limited origin degrades that slice (the rest of the desk still boots).

## Honest limits

- PAPER fills on Solana include a small slip plus the venue fee. LIVE Jupiter priority fees, MEV, and impact are worse.
- LIVE requires typing `LIVE` each browser session. Kill switch flips back to PAPER; signed tickets still need a hand close or flatten.
- Pool “unique takers” are not unique humans.
- Unlock calendars, treasuries, audits, and protocol revenue are **not** in these feeds.
- A research score is a ranking heuristic, not a valuation.
- Fast 5m signals overfit noise. Silence is a valid position.
- Static Pages cannot persist a shared book. Each browser has its own paper account.

## License

Private research software. Use at your own risk.
