import type { ChainId } from "@/lib/chain";
import {
  CRIMECAT_MINT,
  CRONOS_USDC,
  JITO_SOL_MINT,
  JLP_MINT,
  MERY_MINT,
  PACK_MINT,
  PUMP_MINT,
  RAY_MINT,
  SOL_MINT,
  ULTCAT_MINT,
  ULTI_MINT,
  USDC_MINT,
  WCRO_MINT,
  ZBCN_MINT,
  ZEC_MINT,
} from "./universe";

const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const JTO_MINT = "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL";
const ORCA_MINT = "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE";
const PYTH_MINT = "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3";
const DRIFT_MINT = "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7";
const MNDE_MINT = "MNDEFzGvMt87ueuHvVU9VcTQSQB6XND51pVSJD1YJXB";
const HNT_MINT = "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrE3XEbKcP";
const RENDER_MINT = "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof";
const W_MINT = "85VBFQZC9TZkfaptBWtv8W11s6tJy3Dg6ZEr3GUeA6S";
const TNSR_MINT = "TNSRxcUxoT9xBG3de7PiWmgQhEQ1e6bwS4P8Cdgx31A";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF_MINT = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

const SOL_LOGO = "https://assets.coingecko.com/coins/images/4128/small/solana.png";
const CRO_LOGO = "https://assets.coingecko.com/coins/images/7310/small/cro_token_logo.png";

/** Official brand marks. SOL and CRO use the native coin, not wrapped-ticker art. */
const BY_MINT: Record<string, string> = {
  [SOL_MINT.toLowerCase()]: SOL_LOGO,
  [WCRO_MINT.toLowerCase()]: CRO_LOGO,
  [USDC_MINT.toLowerCase()]: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
  [CRONOS_USDC.toLowerCase()]: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
  [ZBCN_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/37052/small/zbcn.jpeg",
  [PUMP_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/67164/small/pump.jpg",
  [ZEC_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/70472/small/zcash.png",
  [RAY_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/13928/small/PSigc4ie_400x400.jpg",
  [JITO_SOL_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/28452/small/jito.png",
  [JLP_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/34188/small/jup.png",
  [JUP_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/34188/small/jup.png",
  [JTO_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/33228/small/jto.png",
  [ORCA_MINT.toLowerCase()]: "https://assets.coingecko.com/coins/images/17547/small/Orca_Logo.png",
  [PYTH_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/31924/small/pyth.png",
  [DRIFT_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/31242/small/drift.png",
  [MNDE_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/18867/small/MNDE.png",
  [HNT_MINT.toLowerCase()]: "https://assets.coingecko.com/coins/images/5667/small/Helium_HNT.png",
  [RENDER_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/11636/small/rndr.png",
  [W_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/35087/small/wormhole.png",
  [TNSR_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/35996/small/tnsr.png",
  [BONK_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/28600/small/bonk.jpg",
  [WIF_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/33566/small/dogwifhat.jpg",
  [ULTCAT_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/102178961/small/Screenshot_2026-09-28_at_1.24.07%E2%80%AFPM.png",
  [CRIMECAT_MINT.toLowerCase()]: "/t800-trader/logos/crimecat.svg",
  [MERY_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/36620/small/Mistery_Fam_%281%29.png",
  [PACK_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/71685/small/logo-transparent.png",
  [ULTI_MINT.toLowerCase()]: "https://coin-images.coingecko.com/coins/images/102179280/small/3627.png",
};

const BY_SYMBOL: Record<string, string> = {
  BTC: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
  ETH: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  SOL: SOL_LOGO,
  CRO: CRO_LOGO,
  WCRO: CRO_LOGO,
  WSOL: SOL_LOGO,
  JITOSOL: BY_MINT[JITO_SOL_MINT.toLowerCase()],
  USDC: BY_MINT[USDC_MINT.toLowerCase()],
  ZBCN: BY_MINT[ZBCN_MINT.toLowerCase()],
  PUMP: BY_MINT[PUMP_MINT.toLowerCase()],
  ZEC: BY_MINT[ZEC_MINT.toLowerCase()],
  RAY: BY_MINT[RAY_MINT.toLowerCase()],
  ULTCAT: BY_MINT[ULTCAT_MINT.toLowerCase()],
  CRIMECAT: BY_MINT[CRIMECAT_MINT.toLowerCase()],
  MERY: BY_MINT[MERY_MINT.toLowerCase()],
  PACK: BY_MINT[PACK_MINT.toLowerCase()],
  ULTI: BY_MINT[ULTI_MINT.toLowerCase()],
  JUP: BY_MINT[JUP_MINT.toLowerCase()],
  JTO: BY_MINT[JTO_MINT.toLowerCase()],
  BONK: BY_MINT[BONK_MINT.toLowerCase()],
  WIF: BY_MINT[WIF_MINT.toLowerCase()],
};

export function tokenLogoUrl(input: { mint?: string | null; symbol?: string | null; chain?: ChainId }): string | null {
  const mint = (input.mint ?? "").trim().toLowerCase();
  if (mint && BY_MINT[mint]) return BY_MINT[mint];
  const symbol = (input.symbol ?? "").trim().toUpperCase();
  if (symbol && BY_SYMBOL[symbol]) return BY_SYMBOL[symbol];
  return null;
}

/** First ticker in a status line, only when that name has a known mark. */
export function leadingTokenSymbol(text: string): string | null {
  const match = text.trim().match(/^([A-Za-z][A-Za-z0-9]{1,11})\b/);
  if (!match) return null;
  const symbol = match[1].toUpperCase();
  return BY_SYMBOL[symbol] ? symbol : null;
}

export function tokenInitials(symbol: string): string {
  const clean = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (clean.length <= 2) return clean || "?";
  return clean.slice(0, 2);
}

const BASE = "/t800-trader/logos";

/** Official DEX marks shipped with the desk. */
const VENUE_LOGO: Record<string, string> = {
  raydium: `${BASE}/raydium.jpg`,
  orca: `${BASE}/orca.jpg`,
  meteora: `${BASE}/meteora.png`,
  jupiter: `${BASE}/jupiter.jpg`,
  pump: `${BASE}/pump.jpg`,
  wolfswap: `${BASE}/wolfswap.svg`,
  vvs: `${BASE}/vvs.jpg`,
  crotrade: `${BASE}/crotrade.png`,
};

export function venueLogoUrl(id: string): string | null {
  return VENUE_LOGO[id] ?? null;
}
