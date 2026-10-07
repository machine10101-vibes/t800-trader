# Live Solana trading

Default mode is **PAPER**. Nothing is sent on-chain until you explicitly enable LIVE, type `LIVE` this session, and arm the desk.

There is **no seed phrase in the repo**, **no server wallet**, and **no custody**. The static GitHub Pages export talks to public RPC and Jupiter from the browser.

## What can go live

| Action | LIVE | Notes |
| --- | --- | --- |
| Long open | Yes | After you arm, a browser trading key sends Jupiter ExactIn (USDC or SOL → token). |
| Long close (button, stop, target, trail, time) | Yes | Token → USDC. If the trading key has under 0.006 SOL, Jupiter Ultra sponsors the fee so Phantom's 0.005 SOL warning does not block the close. Positions under about $10 cannot be sponsored — add 0.006 SOL first. |
| SOL 5x / 10x | Yes | Jupiter perps on the polished desk, when the trading key can post collateral. |
| Short open / cover | **No** | Spot Solana has no native short. Shorts stay paper-only. |
| Cronos | Separate | VVS path on the Cronos desk. LIVE confirm is Solana-only. |

## Enable LIVE

1. Connect Phantom or Solflare.
2. Fund the wallet with **USDC** for buys and enough **SOL** for fees (default floor `0.02` SOL).
3. Open **Book** or **Options** and click **Enable LIVE…**
4. Check the loss acknowledgement and type `LIVE`.
5. Arm the bot. The wallet signs once to fund the trading key. That key sends each Jupiter swap.
6. After confirm, the ticket stores the signature (Solscan link) and the book refreshes balances.

Reload locks LIVE again. The preference may still say LIVE, but this session will not send until you re-confirm. **Kill LIVE** immediately sets PAPER, stops the bot, and disarms the session. Signed tickets can still be closed by hand.

## Env (all optional, all public)

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SOLANA_RPC` | PublicNode | Read balances, decimals, confirm signatures, optional raw send |
| `NEXT_PUBLIC_JUPITER_API` | `https://lite-api.jup.ag/swap/v1` | Keyless quote + swap build |
| `NEXT_PUBLIC_JUPITER_ULTRA_API` | `https://lite-api.jup.ag/ultra/v1` | Fee-sponsored closes when SOL is under 0.006 |
| `NEXT_PUBLIC_JUPITER_API_KEY` | unset | Optional `x-api-key` if you use `https://api.jup.ag/swap/v1` |

No private key env vars exist. Do not add any.

Rebuild after changing `NEXT_PUBLIC_*` (`npm run build` or `npm run dev`).

## Risk knobs

- **Live slippage** (default 80 bps)
- **Max live size** (default $250 USDC per ticket)
- **Min SOL for fees** (default 0.02)
- Existing paper risk: per-trade %, daily loss cap, max positions, liquidity floor
- Preflight refuses: kill switch, unarmed session, shorts, dust, oversize

## Dry-run / tests

`planLiveSwap` quotes and deserializes a transaction but does not sign or send. Unit tests mock Jupiter and assert that path.

`npm test` does **not** open a wallet. Phantom/Solflare approve is SKIPPED in CI.

## Risks

- You can lose the USDC you swap plus SOL fees, and leveraged tickets can lose faster.
- The minute-bar replay in the README found no configuration that was profitable after fees in both test windows. The Solana defaults lose the least, but they still lose. 5x and 10x lost more in every run.
- Jupiter lite-api is rate-limited (~0.5 rps keyless). A burst of ticks can 429.
- Public RPC can drop or delay confirmations. The desk reports the signature even if refresh is slow.
- Paper fills are mid + a small slip + the venue fee. Live impact, MEV, and priority fees are worse.
- This is not financial advice.
