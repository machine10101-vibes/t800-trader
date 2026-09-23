export type Timeframe = "m5" | "m15" | "m30" | "h1" | "h6" | "h24";

export type Sector =
  | "L1"
  | "DEX"
  | "Perps"
  | "LST"
  | "DePIN"
  | "Oracle"
  | "Lending"
  | "Meme"
  | "Infra"
  | "Payments"
  | "Unknown";

export type Side = "long" | "short";
export type TradeReason =
  | "breakout"
  | "reclaim"
  | "fade"
  | "stop"
  | "target"
  | "trail"
  | "time"
  | "manual"
  | "risk-off";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FlowWindow {
  buys: number;
  sells: number;
  buyers: number;
  sellers: number;
  volumeUsd: number;
  priceChangePct: number;
}

export interface TokenCandidate {
  id: string;
  chain: "solana";
  symbol: string;
  name: string;
  mint: string;
  poolAddress: string;
  dex: string;
  quoteSymbol: string;
  priceUsd: number;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  poolCreatedAt: string | null;
  ageHours: number | null;
  sector: Sector;
  flows: Record<Timeframe, FlowWindow>;
  watchlist: boolean;
  sources: string[];
}

export interface TechnicalSnapshot {
  rsi14: number | null;
  ema9: number | null;
  ema21: number | null;
  vwap: number | null;
  atrPct: number | null;
  volumeZ: number | null;
  lastClose: number | null;
  extensionPct: number | null;
  closeStrength: number | null;
  priorHigh: number | null;
  priorLow: number | null;
  barsAboveEma9: number;
}

export interface ScoredCandidate extends TokenCandidate {
  researchScore: number;
  technical: TechnicalSnapshot;
  penalties: string[];
  strengths: string[];
  keyMetric: string;
  keyMetricValue: string;
  organicScore: number;
  valuationScore: number;
  activityScore: number;
  riskScore: number;
}

export interface Catalyst {
  window: "30d" | "1-3m" | "3-6m" | "6-12m";
  title: string;
  status: "confirmed" | "speculative";
  detail: string;
}

export interface ResearchThesis {
  id: string;
  ticker: string;
  asset: string;
  price: number;
  marketCap: number | null;
  fdv: number | null;
  sector: Sector;
  coreThesis: string;
  whyMispriced: string;
  fundamentalEvidence: string[];
  onchainEvidence: string[];
  tokenomics: string;
  relativeValuation: string;
  competitivePositioning: string;
  catalysts: Catalyst[];
  keyCatalyst: string;
  biggestRisk: string;
  keyMetric: string;
  researchScore: number;
  bullCase: string;
  baseCase: string;
  bearCase: string;
  invalidation: string[];
  monitor: string[];
  sources: string[];
  missingData: string[];
  candidate: ScoredCandidate;
}

export interface MarketRegime {
  asOf: string;
  btc: { price: number; change24h: number; marketCap: number; volume24h: number };
  eth: { price: number; change24h: number; marketCap: number; volume24h: number };
  sol: { price: number; change24h: number; marketCap: number; volume24h: number };
  btcDominance: number | null;
  ethDominance: number | null;
  totalMarketCap: number | null;
  marketCapChange24h: number | null;
  fearGreed: { value: number; label: string } | null;
  solanaTvl: number | null;
  solanaDexVolume24h: number | null;
  solanaDexVolumeChange1d: number | null;
  stance: "risk-on" | "mixed" | "defensive";
  stanceWhy: string;
  crowded: string[];
  overlooked: string[];
  overview: string;
  narratives: string[];
}

export interface Signal {
  id: string;
  mint: string;
  symbol: string;
  poolAddress: string;
  sector: Sector;
  side: Side;
  reason: TradeReason;
  confidence: number;
  price: number;
  stopPct: number;
  targetPct: number;
  thesis: string;
  researchScore: number | null;
  createdAt: string;
}

export interface Position {
  id: string;
  mint: string;
  symbol: string;
  poolAddress: string;
  sector: Sector;
  side: Side;
  qty: number;
  entryPrice: number;
  markPrice: number;
  stopPrice: number;
  targetPrice: number;
  openedAt: string;
  lastUpdate: string;
  reason: TradeReason;
  researchScore: number | null;
  highWater: number;
  lowWater: number;
  notional: number;
  initialStop: number;
  scaled: boolean;
}

export interface Trade {
  id: string;
  mint: string;
  symbol: string;
  side: Side;
  action: "open" | "close";
  qty: number;
  price: number;
  pnlUsd: number | null;
  pnlPct: number | null;
  reason: TradeReason;
  at: string;
  note: string;
}

export interface BotConfig {
  startingEquity: number;
  maxPositions: number;
  maxRiskPerTradePct: number;
  dailyLossLimitPct: number;
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  minAgeHours: number;
  allowShorts: boolean;
  allowMemes: boolean;
  scanSeconds: number;
}

export interface BotState {
  running: boolean;
  lastTickAt: string | null;
  lastError: string | null;
  ticks: number;
  startedAt: string | null;
  lastNote: string | null;
  lastOpened: number;
  lastClosed: number;
  blocked: string[];
}

export interface Portfolio {
  cashUsd: number;
  equityUsd: number;
  peakEquity: number;
  dayStartEquity: number;
  dayPnlUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  winCount: number;
  lossCount: number;
  tradeCount: number;
}

export interface EquityPoint {
  t: string;
  equity: number;
}

export interface AppState {
  config: BotConfig;
  bot: BotState;
  portfolio: Portfolio;
  positions: Position[];
  trades: Trade[];
  equityCurve: EquityPoint[];
  lastSignals: Signal[];
}

export interface TapeDot {
  mint: string;
  symbol: string;
  score: number;
  change24h: number;
  liquidityUsd: number;
  volume24hUsd: number;
}

export interface BookStats {
  expectancyUsd: number;
  profitFactor: number | null;
  avgWinUsd: number;
  avgLossUsd: number;
  closedTrades: number;
  maxDrawdownPct: number;
}

export interface DeskPayload {
  regime: MarketRegime;
  research: ResearchThesis[];
  universeSize: number;
  eliminated: number;
  candidatesScanned: number;
  portfolio: Portfolio;
  positions: Position[];
  trades: Trade[];
  signals: Signal[];
  bot: BotState;
  config: BotConfig;
  equityCurve: EquityPoint[];
  whatCouldBeWrong: string[];
  tapeDots: TapeDot[];
  stats: BookStats;
  generatedAt: string;
}
