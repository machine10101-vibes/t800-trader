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
  /** Cross-checked mark. `split` means feeds disagree and the book will not open a new ticket. */
  priceAgreement?: "agree" | "thin" | "split";
  /** Percent, already scaled (4.98 means 4.98%). Null when no feed confirmed a yield for this mint. */
  apyPct?: number | null;
  apySources?: string[];
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
  /** Compact public yields (LST, JLP, lend). Empty when those feeds missed the cycle. */
  yields?: { label: string; apyPct: number; source: string }[];
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
  entryConfidence?: number;
  entryStance?: MarketRegime["stance"];
  highWater: number;
  lowWater: number;
  notional: number;
  initialStop: number;
  scaled: boolean;
  /** Set when a wallet signed the open. Missing means the ticket never left this browser. */
  signature?: string;
  tokenDecimals?: number;
  /** Jupiter perp multiplier. Missing or 1 is a spot swap. */
  leverage?: number;
  /** Margin posted for a perp. Spot tickets leave this empty and lock the full notional. */
  collateralUsd?: number;
  /** Jupiter perp position account, required to close a 5x or 10x ticket. */
  positionPubkey?: string;
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
  /** Solana signature for a wallet swap. Missing means the row is simulated. */
  signature?: string;
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
  oneTicketPerTick: boolean;
  microOneTicket: boolean;
  maxPerSector: number;
  lossStreakPause: number;
  cooldownMinutes: number;
  minConfidence: number;
  autoCash: boolean;
  cashPct: number;
  dayBudgetPct: number;
  defensiveBreakoutScore: number;
  beR: number;
  scaleAtR: number;
  scaleFractionPct: number;
  lockAtR: number;
  lockProfitR: number;
  timeCapMin: number;
  memeTimeCapMin: number;
  staleMin: number;
  memeStaleMin: number;
  scratchEnabled: boolean;
  /** Platform ids from VENUE_OPTIONS. New tickets only open on these pools. */
  venues: string[];
  /** When on, buys and sells ask the connected wallet to sign a Jupiter swap. */
  walletSwaps: boolean;
  /**
   * Jupiter perp multipliers for SOL. 10x is used when the signal is strong.
   * An empty list keeps every ticket a spot swap. Zebec has no perp.
   */
  multipliers: number[];
  /**
   * Books saved before live swaps were the default have no rev and are switched on once.
   * After that, an explicit off stays off.
   */
  liveTradesRev: number;
}

export interface ChainOrder {
  kind: "open" | "close" | "scale";
  side: Side;
  mint: string;
  symbol: string;
  notionalUsd: number;
  qty: number;
  price: number;
  tokenDecimals?: number;
  venues?: string[];
  /** 5 or 10 sends a Jupiter SOL perp. Missing keeps the ticket a spot swap. */
  leverage?: number;
  collateralUsd?: number;
  positionPubkey?: string;
}

export interface ChainFill {
  signature: string;
  qty: number;
  price: number;
  tokenDecimals: number;
  leverage?: number;
  collateralUsd?: number;
  positionPubkey?: string;
}

export type ChainExecutor = (order: ChainOrder) => Promise<ChainFill>;

export interface RestingQuote {
  orderKey: string;
  signature: string;
  mint: string;
  symbol: string;
  poolAddress: string;
  sector: Sector;
  side: "long";
  reason: TradeReason;
  confidence: number;
  researchScore: number | null;
  stopPct: number;
  targetPct: number;
  thesis: string;
  limitPrice: number;
  notionalUsd: number;
  outputDecimals: number;
  placedAt: string;
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
  /** Set when the wallet declines a signature, so the next scan does not pop the prompt again immediately. */
  swapHoldUntil?: string | null;
  /** A hand close. The scan will not reopen this mint until `until`. */
  skipReentry?: { mint: string; until: string } | null;
  /** A Jupiter limit bid waiting for a taker. The position is booked only after it fills. */
  resting?: RestingQuote | null;
  /** Signature of the arm transaction that funded the browser trading key. */
  swapAuthSignature?: string | null;
  /** Address that signs Jupiter swaps after that arm transaction. */
  swapBot?: string | null;
  /** USD marked on the trading key when it was funded. Cash above this is profit. */
  swapPrincipalUsd?: number | null;
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
  sessionDay?: string;
}

export interface EquityPoint {
  t: string;
  equity: number;
}

export interface Lesson {
  id: string;
  at: string;
  kind: "trade" | "read";
  key: string;
  symbol: string;
  sector: string;
  hit: boolean;
  /** R multiple for a trade, percent move for a tape read. */
  r: number;
  note: string;
}

export interface PendingRead {
  id: string;
  at: string;
  mint: string;
  symbol: string;
  sector: string;
  price: number;
  score: number;
  mode: "follow" | "defend";
  bucket: string;
}

export interface PlayMemory {
  lessons: Lesson[];
  pendingReads: PendingRead[];
}

export interface LearningEdge {
  key: string;
  label: string;
  samples: number;
  hitRate: number;
  avgR: number;
  unit: "R" | "%";
  bias: "favor" | "fade" | "watch";
}

export interface LearningReport {
  tradeSamples: number;
  readSamples: number;
  edges: LearningEdge[];
  recent: Lesson[];
  summary: string;
}

export interface AppState {
  config: BotConfig;
  bot: BotState;
  portfolio: Portfolio;
  positions: Position[];
  trades: Trade[];
  equityCurve: EquityPoint[];
  lastSignals: Signal[];
  memory: PlayMemory;
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

export interface TapeCard {
  symbol: string;
  mint: string;
  poolAddress: string;
  change15m: number;
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
  tapes: TapeCard[];
  stats: BookStats;
  learning: LearningReport;
  generatedAt: string;
}
