import { fetchJson, nullableNum } from "@/lib/utils";
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
      { timeoutMs: 8_000, retries: 2 },
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
      { timeoutMs: 8_000, retries: 2 },
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
      timeoutMs: 8_000,
      retries: 2,
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
    }>(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`, { timeoutMs: 8_000, retries: 2 });
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
  const cg = await fromCoinGecko();
  if (cg?.btc.price && cg.eth.price && cg.sol.price) return cg;

  const [btc, eth, solGt, solDx] = await Promise.all([
    cg?.btc.price ? Promise.resolve(cg.btc) : fromCoinCap("bitcoin"),
    cg?.eth.price ? Promise.resolve(cg.eth) : fromCoinCap("ethereum"),
    cg?.sol.price ? Promise.resolve(cg.sol) : solFromGeckoTerminal(),
    cg?.sol.price ? Promise.resolve(EMPTY) : solFromDexScreener(),
  ]);
  const solCap = cg?.sol.price ? cg.sol : await fromCoinCap("solana");
  return {
    btc: prefer(cg?.btc ?? EMPTY, btc),
    eth: prefer(cg?.eth ?? EMPTY, eth),
    sol: prefer(prefer(cg?.sol ?? EMPTY, solCap), prefer(solGt, solDx)),
  };
}

export async function liveSolPrice(): Promise<number | null> {
  const { sol } = await liveMajors();
  return sol.price;
}
