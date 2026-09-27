# T-800 Trader

Solana-first research desk and short-term trading bot. Default execution is **PAPER**. **LIVE** Jupiter swaps are opt-in.

Play it at **https://machine10101-vibes.github.io/t800-trader/**

Connect a real **Phantom** or **Solflare** wallet to arm the desk. There is no demo book and no $10,000 fallback. The book is sized from the wallet’s live SOL + USDC.

The desk does not start from a celebrity coin list. It pulls a live Solana universe (watchlist venues plus trending, new, and high-volume pools), throws out thin or obviously adversarial tape, then keeps 5–8 finalists. A separate execution loop will only paper-trade names that survived that screen, and only when 5-minute structure, volume, and risk limits agree.

This is a research tool and **not** financial advice. PAPER never sends a transaction. LIVE can spend real USDC after you type `LIVE` on the Risk tab and approve each swap in Phantom or Solflare. See [LIVE_TRADING.md](./LIVE_TRADING.md).

The published site is a **static** Next.js export. Overview, Radar, thesis drawer, Arm / Force tick, Book, and Risk all run in the browser. Paper state lives in `localStorage` (key `t800-trader-state`). There is no Node server and no `data/state.json` on GitHub Pages.

## What you get

- **Overview** — BTC / ETH / SOL regime, dominance, Fear & Greed, Solana TVL, Solana DEX volume, crowded vs overlooked tape
- **Radar** — comparison table (asset, ticker, price, market cap, FDV, sector, thesis, catalyst, risk, key metric, score)
- **Thesis drawer** — core thesis, mispricing argument, fundamental and tape evidence, tokenomics gaps, valuation, competition, dated catalyst windows, bull / base / bear, invalidation, monitors, sources
- **Bot** — arm / disarm, force tick, live signals (breakout, RSI reclaim, climax fade)
- **Book** — paper or live equity, open positions, tickets, Solscan signatures
- **Risk** — PAPER/LIVE toggle, kill switch, slippage, max live size, per-trade risk, daily loss cap

## How the bot thinks

1. **Regime** from CoinGecko, Alternative.me, and DefiLlama
2. **Universe** from GeckoTerminal Solana pools + a conservative watchlist (JUP, JTO, RAY, Drift, Pyth, …)
3. **Screen** — liquidity, 24h volume, pool age, quote asset, optional meme ban
4. **Score** — organic flow, valuation hygiene, activity, venue risk, 5m technicals
5. **Trade** — PAPER simulates fills; LIVE longs are Jupiter USDC↔token swaps signed in the wallet. Spot shorts cannot go live (no perps).
6. **Skeptic pass** — missing unlocks, revenue, and holder data are listed, never invented

Default book: live SOL + USDC from the connected wallet (no $10,000 demo fallback). Max 4 positions. ~1.1% equity risk per trade, cut in defensive regimes. Daily loss cap 6%.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000/t800-trader/](http://localhost:3000/t800-trader/). The `/t800-trader` base path matches GitHub Pages. Connect a wallet, then press **Space** to arm or disarm the bot. The desk boots in PAPER. Enable LIVE from Risk only if you intend to spend USDC.

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
| [Jupiter lite-api](https://lite-api.jup.ag) | LIVE quotes and unsigned swap transactions |

No API keys required for the public endpoints above. Rate limits apply. On Pages the browser calls these feeds directly, so a blocked or rate-limited origin degrades that slice (the rest of the desk still boots).

## Honest limits

- Paper fills assume a small mid-price slip. LIVE Jupiter swaps pay real priority fees, MEV, and impact.
- LIVE requires a wallet approval per swap. A rejected popup skips that ticket.
- Pool “unique takers” are not unique humans.
- Unlock calendars, treasuries, audits, and protocol revenue are **not** in these feeds.
- A research score is a ranking heuristic, not a valuation.
- Fast 5m signals overfit noise. Silence is a valid position.
- Static Pages cannot persist a shared book. Each browser has its own paper account.

## License

Private research software. Use at your own risk.
