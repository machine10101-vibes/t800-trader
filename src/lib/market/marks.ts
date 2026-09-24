import { fetchJson, firstSuccess, nullableNum } from "@/lib/utils";
import { SOL_MINT } from "./universe";

export interface Mark {
  price: number | null;
  change24h: number | null;
}

const EMPTY: Mark = { price: null, change24h: null };

interface CgSimple {
  [id: string]: { usd?: number; usd_24h_change?: number };
}

async function fromCoinGecko(): Promise<{ btc: Mark; eth: Mark; sol: Mark } | null> {
  try {
    const json = await fetchJson<CgSimple>(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true",
      { timeoutMs: 4_000, retries: 1 },
    );
    const pick = (id: string): Mark => ({
      price: nullableNum(json[id]?.usd),
      change24h: nullableNum(json[id]?.usd_24h_change),
    });
    const btc = pick("bitcoin");
    const eth = pick("ethereum");
    const sol = pick("solana");
    if (!btc.price && !eth.price && !sol.price) return null;
    return { btc, eth, sol };
  } catch {
    return null;
  }
}

async function fromCoinCap(id: string): Promise<Mark> {
  try {
    const json = await fetchJson<{ data?: { priceUsd?: string; changePercent24Hr?: string } }>(
      `https://api.coincap.io/v2/assets/${id}`,
      { timeoutMs: 4_000, retries: 1 },
    );
    return {
      price: nullableNum(json.data?.priceUsd),
      change24h: nullableNum(json.data?.changePercent24Hr),
    };
  } catch {
    return EMPTY;
  }
}

async function solFromGeckoTerminal(): Promise<Mark> {
  try {
    const json = await fetchJson<{
      data?: { attributes?: { token_prices?: Record<string, string> } };
    }>(`https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price/${SOL_MINT}`, {
      timeoutMs: 4_000,
      retries: 1,
    });
    return { price: nullableNum(json.data?.attributes?.token_prices?.[SOL_MINT]), change24h: null };
  } catch {
    return EMPTY;
  }
}

async function solFromDexScreener(): Promise<Mark> {
  try {
    const json = await fetchJson<{
      pairs?: { priceUsd?: string; priceChange?: { h24?: number } }[];
    }>(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`, { timeoutMs: 2_500, retries: 1 });
    const pair = json.pairs?.find((p) => nullableNum(p.priceUsd)) ?? json.pairs?.[0];
    return {
      price: nullableNum(pair?.priceUsd),
      change24h: nullableNum(pair?.priceChange?.h24),
    };
  } catch {
    return EMPTY;
  }
}

function prefer(primary: Mark, fallback: Mark): Mark {
  return {
    price: primary.price ?? fallback.price,
    change24h: primary.change24h ?? fallback.change24h,
  };
}

export async function liveMajors(): Promise<{ btc: Mark; eth: Mark; sol: Mark }> {
  const [cg, btcCap, ethCap, solCap, solDx] = await Promise.all([
    fromCoinGecko(),
    fromCoinCap("bitcoin"),
    fromCoinCap("ethereum"),
    fromCoinCap("solana"),
    solFromDexScreener(),
  ]);
  let sol = prefer(prefer(cg?.sol ?? EMPTY, solCap), solDx);
  if (!sol.price) sol = prefer(sol, await solFromGeckoTerminal());
  return {
    btc: prefer(cg?.btc ?? EMPTY, btcCap),
    eth: prefer(cg?.eth ?? EMPTY, ethCap),
    sol,
  };
}

const SOL_PRICE_TTL_MS = 20_000;
let solPriceCache: { at: number; price: number } | null = null;

async function solUsd(url: string, pick: (json: unknown) => number | null): Promise<number | null> {
  try {
    const json = await fetchJson<unknown>(url, { timeoutMs: 2_500, retries: 1 });
    const price = pick(json);
    return price && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/** Wallet equity only needs SOL. Take the first live print instead of waiting on BTC, ETH, and retries. */
export async function liveSolPrice(): Promise<number | null> {
  if (solPriceCache && Date.now() - solPriceCache.at < SOL_PRICE_TTL_MS) return solPriceCache.price;
  const price = await firstSuccess(
    [
      solUsd(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, (json) => {
        const row = json as Record<string, { usdPrice?: number }>;
        return nullableNum(row[SOL_MINT]?.usdPrice);
      }),
      solFromDexScreener().then((mark) => mark.price),
      solUsd(`https://coins.llama.fi/prices/current/solana:${SOL_MINT}`, (json) => {
        const row = json as { coins?: Record<string, { price?: number }> };
        return nullableNum(row.coins?.[`solana:${SOL_MINT}`]?.price);
      }),
      solUsd(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        (json) => nullableNum((json as CgSimple).solana?.usd),
      ),
    ],
    (value) => typeof value === "number" && value > 0,
  );
  if (price && price > 0) solPriceCache = { at: Date.now(), price };
  return price;
}
