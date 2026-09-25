"use client";

import { CHAIN_COPY, type ChainId } from "@/lib/chain";
import { VENUE_OPTIONS, venueSummary } from "@/lib/market/venues";
import { DEFAULT_CONFIG, normalizeConfig } from "@/lib/store";
import type { BotConfig, DeskPayload } from "@/lib/types";
import { useEffect, useMemo, useState, type ReactNode } from "react";

export function SettingsPanel({
  chain = "solana",
  desk,
  busy,
  onSave,
  onReset,
}: {
  chain?: ChainId;
  desk: DeskPayload;
  busy: boolean;
  onSave: (config: Partial<BotConfig>) => void;
  onReset: () => void;
}) {
  const copy = CHAIN_COPY[chain];
  const [local, setLocal] = useState(() => normalizeConfig(desk.config));
  useEffect(() => setLocal(normalizeConfig(desk.config)), [desk.config]);

  const saved = useMemo(() => normalizeConfig(desk.config), [desk.config]);
  const dirty = JSON.stringify(local) !== JSON.stringify(saved);
  const set = (patch: Partial<BotConfig>) => setLocal((cur) => normalizeConfig({ ...cur, ...patch }));

  return (
    <div className="space-y-4">
      <div className="neon p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-medium">Desk policy</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              These controls change the next scan. The wallet mark still sizes the book. Saving keeps open tickets where
              they are. {copy.settingsReset}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || !dirty} onClick={() => onSave(local)} className="btn btn-ink">
              {dirty ? "Save policy" : "Policy saved"}
            </button>
            <button
              disabled={busy}
              onClick={() => setLocal(normalizeConfig({ ...DEFAULT_CONFIG, startingEquity: local.startingEquity }))}
              className="btn btn-ghost"
            >
              Restore defaults
            </button>
            <button disabled={busy} onClick={onReset} className="btn btn-ghost">
              Reset wallet book
            </button>
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-[var(--faint)]">
          Scan {local.scanSeconds}s · {local.maxPositions} positions · {local.maxRiskPerTradePct.toFixed(1)}% risk · day stop{" "}
          {local.dailyLossLimitPct}% · confidence {local.minConfidence}
          {local.allowShorts ? " · shorts on" : " · shorts off"}
          {local.allowMemes ? " · memes on" : " · memes off"}
          {local.oneTicketPerTick ? " · one ticket per scan" : " · several tickets per scan"}
          {" · "}
          {venueSummary(local.venues)}
          {local.walletSwaps ? " · wallet swaps" : " · simulated fills"}
          {local.multipliers.length ? ` · ${local.multipliers.map((n) => `${n}x`).join(" ")}` : " · spot only"}
        </p>
      </div>

      <Section
        title="Wallet"
        hint="Live swaps are on. Arming asks the wallet to sign once. That transaction funds a trading key in this browser, and that key sends each swap. Turn this off only to keep a simulated blotter."
      >
        <Toggle
          label="Send swaps to this wallet"
          hint={copy.settingsWallet}
          checked={local.walletSwaps}
          onChange={(v) => set({ walletSwaps: v })}
        />
      </Section>

      <Section
        title="Multiplier"
        hint={copy.settingsMultiplier}
      >
        <Toggle
          label="5x"
          hint={copy.settingsFive}
          checked={local.multipliers.includes(5)}
          onChange={(on) => {
            const next = on ? [...local.multipliers, 5] : local.multipliers.filter((n) => n !== 5);
            set({ multipliers: next });
          }}
        />
        <Toggle
          label="10x"
          hint={copy.settingsTen}
          checked={local.multipliers.includes(10)}
          onChange={(on) => {
            const next = on ? [...local.multipliers, 10] : local.multipliers.filter((n) => n !== 10);
            set({ multipliers: next });
          }}
        />
      </Section>

      <Section
        title="Venue"
        hint="New tickets only open on pools from the platforms you leave on. An open ticket stays until it exits, even if you turn its venue off."
      >
        {VENUE_OPTIONS.map((venue) => (
          <Toggle
            key={venue.id}
            label={venue.label}
            hint={venue.hint}
            checked={local.venues.includes(venue.id)}
            onChange={(on) => {
              const venues = on ? [...local.venues, venue.id] : local.venues.filter((id) => id !== venue.id);
              set({ venues });
            }}
          />
        ))}
        {local.venues.length === 0 ? (
          <p className="text-sm text-[var(--crimson)] md:col-span-2">
            No venue is on. The next scan will not open a ticket.
          </p>
        ) : null}
      </Section>

      <Section title="Cadence" hint="How often the bot looks, and how many new tickets a single scan may add.">
        <Field
          label="Scan every"
          hint="The armed bot wakes on this interval. Shorter scans see the tape sooner."
          suffix="s"
          min={6}
          max={60}
          step={1}
          value={local.scanSeconds}
          onChange={(v) => set({ scanSeconds: v })}
        />
        <Field
          label="Cooldown after a stop"
          hint="Minutes a mint stays dark after a stop, time-out, or risk-off exit. Zero turns the cooldown off."
          suffix="m"
          min={0}
          max={180}
          step={5}
          value={local.cooldownMinutes}
          onChange={(v) => set({ cooldownMinutes: v })}
        />
        <Toggle
          label="One new ticket per scan"
          hint="On keeps the bot from opening a basket in one pass. Off lets it fill until a limit stops it."
          checked={local.oneTicketPerTick}
          onChange={(v) => set({ oneTicketPerTick: v })}
        />
        <Toggle
          label="Scratch a long that is not working"
          hint="If a long is still under +0.25R and both the 5m and 15m flip hard, close it."
          checked={local.scratchEnabled}
          onChange={(v) => set({ scratchEnabled: v })}
        />
      </Section>

      <Section title="Universe" hint="Names that fail these screens never reach the signal list.">
        <Field
          label="Min liquidity"
          hint="Pool reserves below this are ignored. Watchlist names still pass a lower floor."
          suffix="k"
          min={20}
          max={1000}
          step={10}
          value={local.minLiquidityUsd / 1000}
          onChange={(v) => set({ minLiquidityUsd: v * 1000 })}
        />
        <Field
          label="Min 24h volume"
          hint="Quiet pools stay off the desk."
          suffix="k"
          min={10}
          max={1000}
          step={10}
          value={local.minVolume24hUsd / 1000}
          onChange={(v) => set({ minVolume24hUsd: v * 1000 })}
        />
        <Field
          label="Min pool age"
          hint="Hours since the pool was created. Zero allows new pools. Watchlist names skip this check."
          suffix="h"
          min={0}
          max={72}
          step={1}
          value={local.minAgeHours}
          onChange={(v) => set({ minAgeHours: v })}
        />
        <Field
          label="Min confidence"
          hint="Signals under this score are blocked. Memes and unknown sectors need four points more."
          min={50}
          max={85}
          step={1}
          value={local.minConfidence}
          onChange={(v) => set({ minConfidence: v })}
        />
        <Field
          label="Defensive breakout score"
          hint="When the tape is defensive, a breakout needs at least this research score."
          min={50}
          max={90}
          step={1}
          value={local.defensiveBreakoutScore}
          onChange={(v) => set({ defensiveBreakoutScore: v })}
        />
        <div className="grid gap-3">
          <Toggle
            label="Allow simulated shorts"
            hint="Shorts still stay off when the tape is defensive."
            checked={local.allowShorts}
            onChange={(v) => set({ allowShorts: v })}
          />
          <Toggle
            label="Allow screened memes"
            hint="Off drops meme names that are not on the watchlist."
            checked={local.allowMemes}
            onChange={(v) => set({ allowMemes: v })}
          />
        </div>
      </Section>

      <Section title="Limits" hint="How much of the book can be at risk at once.">
        <Field
          label="Max positions"
          hint="Open tickets, including ones you entered by hand."
          min={1}
          max={8}
          step={1}
          value={local.maxPositions}
          onChange={(v) => set({ maxPositions: v })}
        />
        <Field
          label="Max per sector"
          hint="Stops a single sector from filling the book."
          min={1}
          max={4}
          step={1}
          value={local.maxPerSector}
          onChange={(v) => set({ maxPerSector: v })}
        />
        <Field
          label="Pause after losses"
          hint="Straight losing closes before new risk pauses. Zero disables the streak pause."
          min={0}
          max={8}
          step={1}
          value={local.lossStreakPause}
          onChange={(v) => set({ lossStreakPause: v })}
        />
        <Field
          label="Daily loss limit"
          hint="New tickets stop once today's drawdown reaches this percent of the day-start equity."
          suffix="%"
          min={2}
          max={15}
          step={0.5}
          value={local.dailyLossLimitPct}
          onChange={(v) => set({ dailyLossLimitPct: v })}
        />
        <Field
          label="Day budget used"
          hint="Stop adding risk once this share of the daily loss limit is already used."
          suffix="%"
          min={50}
          max={100}
          step={5}
          value={local.dayBudgetPct}
          onChange={(v) => set({ dayBudgetPct: v })}
        />
        <Toggle
          label="Micro books ride one ticket"
          hint="A book under $50 keeps a single open ticket so a small wallet is not split into dust."
          checked={local.microOneTicket}
          onChange={(v) => set({ microOneTicket: v })}
        />
      </Section>

      <Section title="Sizing" hint="How large the next ticket is allowed to be.">
        <Field
          label="Risk per trade"
          hint="Percent of equity the stop is allowed to lose. Defensive tape and a loss streak still scale this down."
          suffix="%"
          min={0.3}
          max={2.5}
          step={0.1}
          value={local.maxRiskPerTradePct}
          onChange={(v) => set({ maxRiskPerTradePct: v })}
        />
        <Field
          label="Cash used per ticket"
          hint={
            local.autoCash
              ? "Automatic sizing is on: books under $50 may use 92% of cash, larger books 35%."
              : "Share of cash the next ticket may consume."
          }
          suffix="%"
          min={20}
          max={95}
          step={1}
          value={local.cashPct}
          disabled={local.autoCash}
          onChange={(v) => set({ cashPct: v })}
        />
        <Toggle
          label="Automatic cash sizing"
          hint="On uses 92% for a book under $50 and 35% above that. Off obeys the cash slider on every book."
          checked={local.autoCash}
          onChange={(v) => set({ autoCash: v })}
        />
      </Section>

      <Section title="Management" hint="What the bot does with a ticket after it is open.">
        <Field
          label="Breakeven at"
          hint="Move the stop to a small profit once the trade reaches this R multiple."
          suffix="R"
          min={0.3}
          max={2}
          step={0.05}
          value={local.beR}
          onChange={(v) => set({ beR: v })}
        />
        <Field
          label="Scale out at"
          hint="Sell part of a winner once it reaches this R multiple."
          suffix="R"
          min={0.5}
          max={3}
          step={0.05}
          value={local.scaleAtR}
          onChange={(v) => set({ scaleAtR: v })}
        />
        <Field
          label="Scale size"
          hint="Percent of the ticket closed on the scale-out."
          suffix="%"
          min={25}
          max={75}
          step={5}
          value={local.scaleFractionPct}
          onChange={(v) => set({ scaleFractionPct: v })}
        />
        <Field
          label="Lock profit at"
          hint="Once the trade reaches this R, the stop locks the profit R below."
          suffix="R"
          min={1}
          max={4}
          step={0.1}
          value={local.lockAtR}
          onChange={(v) => set({ lockAtR: v })}
        />
        <Field
          label="Locked profit"
          hint="R multiple the stop protects after the lock level."
          suffix="R"
          min={0.05}
          max={1.5}
          step={0.05}
          value={local.lockProfitR}
          onChange={(v) => set({ lockProfitR: v })}
        />
        <Field
          label="Stale cut"
          hint="Close a non-meme ticket that is still under +0.15R after this many minutes."
          suffix="m"
          min={10}
          max={240}
          step={5}
          value={local.staleMin}
          onChange={(v) => set({ staleMin: v })}
        />
        <Field
          label="Meme stale cut"
          hint="Same stale rule for meme tickets."
          suffix="m"
          min={8}
          max={120}
          step={1}
          value={local.memeStaleMin}
          onChange={(v) => set({ memeStaleMin: v })}
        />
        <Field
          label="Time stop"
          hint="Hard close for a non-meme ticket, even if it is working."
          suffix="m"
          min={30}
          max={360}
          step={10}
          value={local.timeCapMin}
          onChange={(v) => set({ timeCapMin: v })}
        />
        <Field
          label="Meme time stop"
          hint="Hard close for a meme ticket."
          suffix="m"
          min={10}
          max={180}
          step={5}
          value={local.memeTimeCapMin}
          onChange={(v) => set({ memeTimeCapMin: v })}
        />
      </Section>

      <div className="neon p-6">
        <h3 className="text-lg font-medium">What could I be wrong about?</h3>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--muted)]">
          {desk.whatCouldBeWrong.map((w) => (
            <li key={w}>— {w}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="neon p-5 sm:p-6">
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">{hint}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const shown = digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
  return (
    <label className={`block rounded-2xl border border-[var(--line)] bg-black/20 p-3 ${disabled ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="num text-[var(--magenta)]">
          {shown}
          {suffix ?? ""}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--faint)]">{hint}</p>
      <input
        type="range"
        className="mt-3 w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--line)] bg-black/20 p-3 text-left"
    >
      <span>
        <span className="block text-sm">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--faint)]">{hint}</span>
      </span>
      <span
        className={`num mt-0.5 shrink-0 rounded-full px-2 py-1 text-[11px] ${checked ? "bg-[var(--magenta)] text-black" : "border border-[var(--line)] text-[var(--muted)]"}`}
      >
        {checked ? "On" : "Off"}
      </span>
    </button>
  );
}
