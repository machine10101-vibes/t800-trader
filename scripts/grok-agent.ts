/**
 * Manual Solana trades for a Grok agent.
 * The desk runner must be up and the Sol book must already hold this code.
 *
 *   npx tsx scripts/grok-agent.ts connect K7NP-4QHM
 *   npx tsx scripts/grok-agent.ts buy K7NP-4QHM SOL 10 180
 *   npx tsx scripts/grok-agent.ts sell K7NP-4QHM SOL
 */
import { localRunnerOrigin, runnerAgentUrl } from "../src/lib/trading/runtime";

const [action, code, symbol, usd, price] = process.argv.slice(2);

if (!action || !code) {
  console.error("Usage: grok-agent.ts connect|buy|sell CODE [SYMBOL USD PRICE]");
  process.exit(1);
}

const origin = process.env.T800_ORIGIN || localRunnerOrigin();
const body: Record<string, unknown> = { code, action };
if (symbol) body.symbol = symbol;
if (usd !== undefined) body.usd = Number(usd);
if (price !== undefined) body.price = Number(price);

const response = await fetch(runnerAgentUrl(origin), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const text = await response.text();
console.log(text);
process.exit(response.ok ? 0 : 1);
