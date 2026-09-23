import type { ScoredCandidate, TechnicalSnapshot, TokenCandidate } from "@/lib/types";
import { clamp } from "@/lib/utils";

export interface ScreenConfig {
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  minAgeHours: number;
  allowMemes: boolean;
}

export function screenCandidate(c: TokenCandidate, cfg: ScreenConfig): string | null {
  if (c.liquidityUsd < cfg.minLiquidityUsd) return `Liquidity ${c.liquidityUsd.toFixed(0)} below ${cfg.minLiquidityUsd}`;
  if (c.volume24hUsd < cfg.minVolume24hUsd) return `Volume ${c.volume24hUsd.toFixed(0)} below ${cfg.minVolume24hUsd}`;
  if (c.ageHours !== null && c.ageHours < cfg.minAgeHours && !c.watchlist) {
    return `Pool age ${c.ageHours.toFixed(1)}h below ${cfg.minAgeHours}h`;
  }
  if (!cfg.allowMemes && c.sector === "Meme" && !c.watchlist) return "Meme sector excluded by risk policy";
  if (c.priceUsd <= 0) return "Invalid price";
  return null;
}

export function scoreOrganic(c: TokenCandidate): { score: number; notes: string[] } {
  const notes: string[] = [];
  const h1 = c.flows.h1;
  const h24 = c.flows.h24;
  const buyers = h24.buyers + h24.sellers;
  const uniqueShare = buyers > 0 ? h24.buyers / buyers : 0.5;
  const buyShare = h24.buys + h24.sells > 0 ? h24.buys / (h24.buys + h24.sells) : 0.5;
  const burst = h1.volumeUsd > 0 && c.volume24hUsd > 0 ? h1.volumeUsd / (c.volume24hUsd / 24) : 1;

  let score = 50;
  if (buyShare > 0.46 && buyShare < 0.58) {
    score += 12;
    notes.push("Balanced 24h buy/sell tape");
  } else if (buyShare > 0.7) {
    score -= 8;
    notes.push("Buy-side heavy — possible incentive or wash");
  } else if (buyShare < 0.38) {
    score -= 10;
    notes.push("Persistent 24h sell pressure");
  }

  if (uniqueShare > 0.45 && uniqueShare < 0.62) score += 8;
  if (burst > 8 && !c.watchlist) {
    score -= 12;
    notes.push("1h volume is an extreme multiple of the 24h run-rate");
  } else if (burst > 1.6 && burst < 4) {
    score += 6;
    notes.push("Healthy 1h volume expansion");
  }

  if (c.watchlist) {
    score += 8;
    notes.push("Established watchlist venue, not a fresh launch");
  }
  return { score: clamp(score, 0, 100), notes };
}

export function scoreValuation(c: TokenCandidate): { score: number; metric: string; notes: string[] } {
  const notes: string[] = [];
  const mc = c.marketCapUsd;
  const fdv = c.fdvUsd;
  const vol = c.volume24hUsd;
  const liq = c.liquidityUsd;

  let score = 45;
  let metric = "Liquidity / 24h volume";

  if (mc && vol > 0) {
    const volMc = vol / mc;
    metric = "24h volume / market cap";
    if (volMc > 0.08 && volMc < 0.8) {
      score += 18;
      notes.push(`Active turnover ${(volMc * 100).toFixed(1)}% of market cap`);
    } else if (volMc > 2 && !c.watchlist) {
      score -= 10;
      notes.push("Turnover looks casino-like vs stated market cap");
    } else if (volMc < 0.02) {
      score -= 8;
      notes.push("Stale turnover vs market cap");
    }
  }

  if (mc && fdv && fdv > mc * 3) {
    score -= 14;
    notes.push(`FDV is ${(fdv / mc).toFixed(1)}x circulating market cap`);
  } else if (mc && fdv && fdv <= mc * 1.15) {
    score += 8;
    notes.push("FDV ≈ circulating — limited obvious unlock overhang in the feed");
  }

  if (liq > 0 && vol > 0) {
    const liqTurn = vol / liq;
    if (liqTurn > 80 && !c.watchlist) {
      score -= 10;
      notes.push("Volume dwarfs pool reserves — slippage and manipulation risk");
    } else if (liqTurn > 2 && liqTurn < 20) {
      score += 8;
      notes.push("Reserves can absorb observed tape");
    }
  }

  if (!mc) {
    notes.push("Circulating market cap not published by the pool feed");
    score -= 6;
  }

  return { score: clamp(score, 0, 100), metric, notes };
}

export function scoreActivity(c: TokenCandidate): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 40;
  const users = c.flows.h24.buyers + c.flows.h24.sellers;
  if (users > 4000) {
    score += 20;
    notes.push(`${users.toLocaleString()} unique 24h takers`);
  } else if (users > 800) {
    score += 12;
    notes.push(`${users.toLocaleString()} unique 24h takers`);
  } else if (users < 80 && !c.watchlist) {
    score -= 15;
    notes.push("Thin unique-trader count");
  }

  if (c.liquidityUsd > 1_000_000) score += 12;
  else if (c.liquidityUsd > 250_000) score += 6;
  if (c.volume24hUsd > 5_000_000) score += 10;
  else if (c.volume24hUsd > 500_000) score += 6;

  const momo = c.flows.h24.priceChangePct;
  if (Math.abs(momo) > 80 && !c.watchlist) {
    score -= 10;
    notes.push("24h move is violent — research edge decays into momentum chasing");
  }
  return { score: clamp(score, 0, 100), notes };
}

export function scoreRisk(c: TokenCandidate): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 70;
  if (c.ageHours !== null && c.ageHours < 24 && !c.watchlist) {
    score -= 25;
    notes.push("Pool younger than 24h");
  } else if (c.ageHours !== null && c.ageHours < 72 && !c.watchlist) {
    score -= 12;
    notes.push("Pool younger than 3 days");
  }
  if (c.sector === "Meme") {
    score -= 15;
    notes.push("Meme sector — narrative and insider tape risk");
  }
  if (c.liquidityUsd < 150_000) {
    score -= 12;
    notes.push("Borderline liquidity for fast exits");
  }
  if (c.dex === "pumpswap" || c.dex === "pump-fun" || c.dex.includes("pump")) {
    score -= 10;
    notes.push("Launchpad venue — treat as high-adversarial flow");
  }
  return { score: clamp(score, 0, 100), notes };
}

export function blendScore(parts: {
  organic: number;
  valuation: number;
  activity: number;
  risk: number;
  technical: number;
}): number {
  return clamp(
    parts.organic * 0.2 +
      parts.valuation * 0.2 +
      parts.activity * 0.2 +
      parts.risk * 0.25 +
      parts.technical * 0.15,
    0,
    100,
  );
}

export function technicalScore(t: TechnicalSnapshot): number {
  if (t.rsi14 === null || t.ema9 === null || t.ema21 === null) return 48;
  let s = 50;
  if (t.ema9 > t.ema21) s += 8;
  else s -= 4;
  if (t.rsi14 > 45 && t.rsi14 < 68) s += 10;
  if (t.rsi14 > 78) s -= 12;
  if (t.rsi14 < 28) s += 4;
  if (t.volumeZ !== null && t.volumeZ > 1.2) s += 6;
  if (t.extensionPct !== null && Math.abs(t.extensionPct) > 6) s -= 8;
  return clamp(s, 0, 100);
}

export function scoreCandidate(c: TokenCandidate, technical: TechnicalSnapshot): ScoredCandidate {
  const organic = scoreOrganic(c);
  const valuation = scoreValuation(c);
  const activity = scoreActivity(c);
  const risk = scoreRisk(c);
  const tech = technicalScore(technical);
  const researchScore = blendScore({
    organic: organic.score,
    valuation: valuation.score,
    activity: activity.score,
    risk: risk.score,
    technical: tech,
  });

  const penalties = [...organic.notes, ...valuation.notes, ...activity.notes, ...risk.notes].filter((n) =>
    /risk|below|heavy|stale|violent|young|meme|launchpad|casino|dwarfs|not published|thin|excluded/i.test(n),
  );
  const strengths = [...organic.notes, ...valuation.notes, ...activity.notes].filter((n) => !penalties.includes(n));

  const volMc = c.marketCapUsd && c.marketCapUsd > 0 ? c.volume24hUsd / c.marketCapUsd : null;
  const keyMetric = volMc !== null ? "Vol / MC" : "Liq / Vol";
  const keyMetricValue =
    volMc !== null
      ? `${(volMc * 100).toFixed(1)}%`
      : c.volume24hUsd > 0
        ? `${(c.liquidityUsd / c.volume24hUsd).toFixed(2)}x`
        : "—";

  return {
    ...c,
    researchScore: Number(researchScore.toFixed(1)),
    technical,
    penalties,
    strengths,
    keyMetric,
    keyMetricValue,
    organicScore: organic.score,
    valuationScore: valuation.score,
    activityScore: activity.score,
    riskScore: risk.score,
  };
}
