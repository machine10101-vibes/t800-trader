import type { AppState, LearningEdge, LearningReport, Lesson, MarketRegime, PendingRead, PlayMemory, Position, Signal } from "@/lib/types";
import { clamp, id } from "@/lib/utils";

const MAX_LESSONS = 160;
const MAX_PENDING = 24;
const READ_WINDOW_MS = 10 * 60_000;
const STANCE_MINT = "__stance__";

export function emptyMemory(): PlayMemory {
  return { lessons: [], pendingReads: [] };
}

export function ensureMemory(memory: PlayMemory | undefined | null): PlayMemory {
  if (!memory || !Array.isArray(memory.lessons) || !Array.isArray(memory.pendingReads)) return emptyMemory();
  return {
    lessons: memory.lessons.filter(isLesson).slice(0, MAX_LESSONS),
    pendingReads: memory.pendingReads.filter(isPending).slice(0, MAX_PENDING),
  };
}

function isLesson(value: Lesson): boolean {
  return Boolean(value && value.kind && value.key && typeof value.hit === "boolean" && typeof value.r === "number");
}

function isPending(value: PendingRead): boolean {
  return Boolean(value && value.mint && value.bucket && value.price > 0 && (value.mode === "follow" || value.mode === "defend"));
}

export function setupKey(side: string, reason: string, sector: string): string {
  return `trade:${side}:${reason}:${sector}`;
}

function smooth(rows: Lesson[]): { hitRate: number; avgR: number } {
  const wins = rows.filter((row) => row.hit).length;
  const sum = rows.reduce((acc, row) => acc + row.r, 0);
  return {
    hitRate: (wins + 2) / (rows.length + 4),
    avgR: sum / (rows.length + 4),
  };
}

function raw(rows: Lesson[]): { hitRate: number; avgR: number } {
  if (!rows.length) return { hitRate: 0, avgR: 0 };
  const wins = rows.filter((row) => row.hit).length;
  return {
    hitRate: wins / rows.length,
    avgR: rows.reduce((acc, row) => acc + row.r, 0) / rows.length,
  };
}

export function rememberClose(
  state: AppState,
  args: { position: Position; pnlUsd: number; r: number; exitReason: string },
): AppState {
  const memory = ensureMemory(state.memory);
  const { position, pnlUsd, r, exitReason } = args;
  const sector = position.sector ?? "Unknown";
  const stance = position.entryStance ? ` ${position.entryStance}` : "";
  const lesson: Lesson = {
    id: id("lsn"),
    at: new Date().toISOString(),
    kind: "trade",
    key: setupKey(position.side, position.reason, sector),
    symbol: position.symbol,
    sector,
    hit: pnlUsd >= 0,
    r,
    note: `${position.symbol} ${position.side} ${position.reason}${stance} closed ${exitReason} ${r >= 0 ? "+" : ""}${r.toFixed(2)}R`,
  };
  return {
    ...state,
    memory: { ...memory, lessons: [lesson, ...memory.lessons].slice(0, MAX_LESSONS) },
  };
}

export interface Advice {
  block: string | null;
  confidenceDelta: number;
  sizeMul: number;
  note: string;
}

export function advise(signal: Signal, memory: PlayMemory | undefined, stance: MarketRegime["stance"]): Advice {
  const mem = ensureMemory(memory);
  const sector = signal.sector ?? "Unknown";
  const setup = mem.lessons.filter((row) => row.kind === "trade" && row.key === setupKey(signal.side, signal.reason, sector));
  const mint = mem.lessons.filter((row) => row.kind === "trade" && row.symbol === signal.symbol);
  const reads = mem.lessons.filter((row) => row.kind === "read" && row.key === `read:${sector}`);
  const stanceRows = mem.lessons.filter((row) => row.kind === "read" && row.key === `read:stance:${stance}`);

  let confidenceDelta = 0;
  let sizeMul = 1;
  let block: string | null = null;
  const notes: string[] = [];

  const setupSmooth = smooth(setup);
  if (setup.length >= 4 && setupSmooth.avgR < -0.12) {
    block = `${signal.symbol}: ${signal.side} ${signal.reason} in ${sector} has a losing book`;
  } else if (setup.length >= 3 && setupSmooth.avgR < 0) {
    confidenceDelta -= 4;
    sizeMul *= 0.85;
    notes.push(`${signal.side} ${signal.reason} in ${sector} is fading`);
  } else if (setup.length >= 3 && setupSmooth.avgR > 0.12 && setupSmooth.hitRate > 0.55) {
    confidenceDelta += 4;
    sizeMul *= 1.08;
    notes.push(`${signal.side} ${signal.reason} in ${sector} has been paying`);
  }

  const recentMint = mint.slice(0, 3);
  if (!block && recentMint.length >= 3 && recentMint.every((row) => !row.hit)) {
    block = `${signal.symbol}: last 3 closes lost`;
  } else if (mint.length >= 3 && smooth(mint).avgR > 0.1 && smooth(mint).hitRate > 0.55) {
    confidenceDelta += 2;
    notes.push(`${signal.symbol} has paid this book`);
  }

  const readSmooth = smooth(reads);
  if (reads.length >= 5 && readSmooth.hitRate < 0.45) {
    confidenceDelta -= 5;
    sizeMul *= 0.9;
    notes.push(`${sector} reads have been early`);
  } else if (reads.length >= 5 && readSmooth.hitRate > 0.62) {
    confidenceDelta += 3;
    notes.push(`${sector} reads have followed through`);
  }

  const stanceSmooth = smooth(stanceRows);
  if (stanceRows.length >= 4 && stance === "defensive" && stanceSmooth.hitRate > 0.6) {
    confidenceDelta -= 2;
    sizeMul *= 0.92;
    notes.push("defensive reads have been right");
  } else if (stanceRows.length >= 4 && stance !== "defensive" && stanceSmooth.hitRate < 0.45) {
    confidenceDelta -= 3;
    sizeMul *= 0.9;
    notes.push("risk-on reads have been early");
  } else if (stanceRows.length >= 4 && stance !== "defensive" && stanceSmooth.hitRate > 0.62) {
    confidenceDelta += 2;
    notes.push("risk-on reads have followed through");
  }

  return {
    block,
    confidenceDelta: clamp(confidenceDelta, -8, 6),
    sizeMul: clamp(sizeMul, 0.7, 1.15),
    note: notes.join(" · "),
  };
}

export function studyTape(
  state: AppState,
  rows: Array<{ mint: string; symbol: string; sector: string; priceUsd: number; researchScore?: number }>,
  stance: MarketRegime["stance"],
  now = Date.now(),
): AppState {
  const ranked = rows
    .filter((row) => row.priceUsd > 0)
    .sort((a, b) => (b.researchScore ?? 0) - (a.researchScore ?? 0))
    .slice(0, 4);
  const prices = new Map(rows.map((row) => [row.mint, row.priceUsd]));
  const mids = ranked.map((row) => row.priceUsd).sort((a, b) => a - b);
  if (mids.length) prices.set(STANCE_MINT, mids[Math.floor((mids.length - 1) / 2)]!);
  let next = gradeReads(state, prices, now);
  next = noteReads(
    next,
    ranked.map((row) => ({
      mint: row.mint,
      symbol: row.symbol,
      sector: row.sector,
      price: row.priceUsd,
      score: row.researchScore ?? 0,
    })),
    stance,
    now,
  );
  return next;
}

function gradeReads(state: AppState, prices: Map<string, number>, now: number): AppState {
  const memory = ensureMemory(state.memory);
  const keep: PendingRead[] = [];
  const lessons = [...memory.lessons];
  for (const read of memory.pendingReads) {
    const age = now - Date.parse(read.at);
    if (age < READ_WINDOW_MS) {
      keep.push(read);
      continue;
    }
    const px = prices.get(read.mint);
    if (!px || read.price <= 0) {
      if (age < 6 * 60 * 60_000) keep.push(read);
      continue;
    }
    const change = ((px - read.price) / read.price) * 100;
    const hit = read.mode === "defend" ? change <= 0.2 : change >= 0.15;
    const move = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
    lessons.unshift({
      id: id("lsn"),
      at: new Date(now).toISOString(),
      kind: "read",
      key: read.bucket,
      symbol: read.symbol,
      sector: read.sector,
      hit,
      r: change,
      note:
        read.mint === STANCE_MINT
          ? `${read.symbol} tape ${hit ? "read held" : "read missed"} ${move}`
          : `${read.symbol} research ${read.score.toFixed(0)} ${hit ? "followed through" : "faded"} ${move}`,
    });
  }
  return { ...state, memory: { lessons: lessons.slice(0, MAX_LESSONS), pendingReads: keep } };
}

function noteReads(
  state: AppState,
  rows: Array<{ mint: string; symbol: string; sector: string; price: number; score: number }>,
  stance: MarketRegime["stance"],
  now: number,
): AppState {
  const memory = ensureMemory(state.memory);
  const pending = [...memory.pendingReads];
  const fresh = (mint: string) => pending.some((row) => row.mint === mint && now - Date.parse(row.at) < READ_WINDOW_MS);
  for (const row of rows) {
    if (row.price <= 0 || fresh(row.mint)) continue;
    pending.unshift({
      id: id("rd"),
      at: new Date(now).toISOString(),
      mint: row.mint,
      symbol: row.symbol,
      sector: row.sector,
      price: row.price,
      score: row.score,
      mode: "follow",
      bucket: `read:${row.sector}`,
    });
  }
  const mid = rows.map((row) => row.price).filter((price) => price > 0).sort((a, b) => a - b);
  if (mid.length && !fresh(STANCE_MINT)) {
    pending.unshift({
      id: id("rd"),
      at: new Date(now).toISOString(),
      mint: STANCE_MINT,
      symbol: stance,
      sector: "Tape",
      price: mid[Math.floor((mid.length - 1) / 2)]!,
      score: 0,
      mode: stance === "defensive" ? "defend" : "follow",
      bucket: `read:stance:${stance}`,
    });
  }
  return { ...state, memory: { ...memory, pendingReads: pending.slice(0, MAX_PENDING) } };
}

function labelFor(key: string): string {
  if (key.startsWith("read:stance:")) return `${key.slice("read:stance:".length)} tape`;
  if (key.startsWith("read:")) return `${key.slice("read:".length)} reads`;
  const [, side, reason, sector] = key.split(":");
  if (side && reason && sector) return `${side} ${reason} · ${sector}`;
  return key;
}

export function learningReport(memory: PlayMemory | undefined): LearningReport {
  const mem = ensureMemory(memory);
  const groups = new Map<string, Lesson[]>();
  for (const lesson of mem.lessons) {
    const rows = groups.get(lesson.key) ?? [];
    rows.push(lesson);
    groups.set(lesson.key, rows);
  }
  const edges: LearningEdge[] = [];
  for (const [key, rows] of groups) {
    if (rows.length < 3) continue;
    const smoothed = smooth(rows);
    const actual = raw(rows);
    const kind = rows[0]?.kind ?? "trade";
    let bias: LearningEdge["bias"] = "watch";
    if (kind === "trade" && rows.length >= 4 && smoothed.avgR < -0.12) bias = "fade";
    else if (rows.length >= 3 && smoothed.avgR > 0.12 && smoothed.hitRate > 0.55) bias = "favor";
    else if (rows.length >= 3 && (smoothed.avgR < 0 || smoothed.hitRate < 0.48)) bias = "fade";
    edges.push({
      key,
      label: labelFor(key),
      samples: rows.length,
      hitRate: actual.hitRate,
      avgR: actual.avgR,
      unit: kind === "read" ? "%" : "R",
      bias,
    });
  }
  edges.sort((a, b) => b.samples - a.samples);
  const tradeSamples = mem.lessons.filter((row) => row.kind === "trade").length;
  const readSamples = mem.lessons.filter((row) => row.kind === "read").length;
  const fading = edges.find((edge) => edge.bias === "fade");
  const paying = edges.find((edge) => edge.bias === "favor");
  const summary =
    tradeSamples + readSamples === 0
      ? "No graded trades or tape reads yet. The next scan starts the journal, and later scans grade whether those reads followed through."
      : `${tradeSamples} closed trade${tradeSamples === 1 ? "" : "s"} and ${readSamples} tape read${readSamples === 1 ? "" : "s"} are in the journal.${paying ? ` Favoring ${paying.label}.` : ""}${fading ? ` Fading ${fading.label}.` : ""}`;
  return {
    tradeSamples,
    readSamples,
    edges: edges.slice(0, 6),
    recent: mem.lessons.slice(0, 6),
    summary,
  };
}
