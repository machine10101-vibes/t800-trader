# T-800 Trader

Solana-first research desk. **PAPER** is the default. Opt-in **LIVE** Jupiter swaps (trading key + Ultra-sponsored closes) after you type `LIVE` this session.

Play it at **https://machine10101-vibes.github.io/t800-trader/**

Connect a real **Phantom** or **Solflare** wallet to arm the desk. There is no demo book and no $10,000 fallback. The book is sized from the wallet’s live SOL + USDC.

The desk does not start from a celebrity coin list. It pulls a live Solana universe (watchlist venues plus trending, new, and high-volume pools), throws out thin or obviously adversarial tape, then keeps 5–8 finalists. A separate execution loop only trades names that survived that screen, and only when 5-minute structure, volume, and risk limits agree.

This is a research tool. It is **not** financial advice. LIVE can lose real USDC and SOL. See [LIVE_TRADING.md](LIVE_TRADING.md).

The published site is a **static** Next.js export (`output: 'export'`, `basePath` / `assetPrefix` `/t800-trader`). Overview, Radar, thesis drawer, Arm, Book, and Options all run in the browser. Book state lives in `localStorage`. There is no Node server and no `data/state.json` on GitHub Pages.

## What you get

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

- PAPER fills assume a small mid-price slip. LIVE Jupiter priority fees, MEV, and impact are worse.
- LIVE requires typing `LIVE` each browser session. Kill switch flips back to PAPER; signed tickets still need a hand close or flatten.
- Pool “unique takers” are not unique humans.
- Unlock calendars, treasuries, audits, and protocol revenue are **not** in these feeds.
- A research score is a ranking heuristic, not a valuation.
- Fast 5m signals overfit noise. Silence is a valid position.
- Static Pages cannot persist a shared book. Each browser has its own paper account.

## License

Private research software. Use at your own risk.
