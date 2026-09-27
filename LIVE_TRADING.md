# Live Solana trading

Default mode is **PAPER**. Nothing is sent on-chain until you explicitly enable LIVE and approve each swap in Phantom or Solflare.

There is **no seed phrase**, **no server wallet**, and **no custody**. The static site asks Jupiter for a quote, builds a VersionedTransaction, and the injected wallet signs it.

## What can go live

| Action | LIVE | Notes |
| --- | --- | --- |
| Long open | Yes | Jupiter ExactIn: USDC → token (or WSOL) |
| Long close (button, stop, target, trail, time) | Yes | Token → USDC. If the wallet has under 0.006 SOL, Jupiter sponsors the fee so Phantom's 0.005 SOL warning does not block the close. Positions under about $10 cannot be sponsored — add 0.006 SOL first. |
| Short open / cover | **No** | Spot Solana has no native short. Shorts stay paper-only. |
| Perps | **No** | Drift/Jupiter perps are not wired |

## Enable LIVE

1. Connect Phantom or Solflare.
2. Fund the wallet with **USDC** for buys and enough **SOL** for fees (default floor `0.02` SOL).
3. Open **Risk**.
4. Click **Enable LIVE…**
5. Check the loss acknowledgement and type `LIVE`.
6. Arm the bot. Each live fill pops a wallet approval.
7. After confirm, the ticket stores the signature (Solscan link) and the book refreshes balances.

Reload locks LIVE again. The preference may still say LIVE, but this session will not send until you re-confirm. **Kill switch** immediately sets PAPER, stops the bot, and disarms the session.

## Env (all optional, all public)

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SOLANA_RPC` | PublicNode | Read balances, decimals, confirm signatures, optional raw send |
| `NEXT_PUBLIC_JUPITER_API` | `https://lite-api.jup.ag/swap/v1` | Keyless quote + swap build |
| `NEXT_PUBLIC_JUPITER_API_KEY` | unset | Optional `x-api-key` if you use `https://api.jup.ag/swap/v1` |

No private key env vars exist. Do not add any.

Rebuild after changing `NEXT_PUBLIC_*` (`npm run build` or `npm run dev`).

## Risk knobs

- **Live slippage** (default 100 bps = 1%)
- **Max live size** (default $50 USDC per swap)
- Existing paper risk: per-trade %, daily loss cap, max positions, liquidity floor
- Preflight refuses: kill switch, unarmed session, shorts, dust, oversize, low USDC, low SOL

## Dry-run / tests

`planLiveSwap` quotes and deserializes a transaction but does not sign or send. Unit tests mock Jupiter and assert that path.

`npm test` does **not** open a wallet. Phantom/Solflare approve is SKIPPED in CI.

## Risks

- You can lose the USDC you swap plus SOL fees.
- Jupiter lite-api is rate-limited (~0.5 rps keyless). A burst of ticks can 429.
- Public RPC can drop or delay confirmations. The desk reports the signature even if refresh is slow.
- Paper marks are mid + 8 bps. Live impact, MEV, and priority fees are worse.
- This is not financial advice.
