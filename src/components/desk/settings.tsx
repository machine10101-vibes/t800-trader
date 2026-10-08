"use client";

import { CHAIN_COPY, type ChainId } from "@/lib/chain";
import { ARM_FUNDS_USD, BUY_SIZE_USD, commitTicketCap, multipliersForMode, nextSettingsDraft, SOL_TRADE_MODES } from "@/lib/deskSettings";
import { VENUE_OPTIONS } from "@/lib/market/venues";
import { DEFAULT_CONFIG, normalizeConfig, solanaDefaults } from "@/lib/store";
import type { BotConfig, DeskPayload } from "@/lib/types";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TokenLogo } from "./TokenLogo";

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
  const [local, setLocal] = useState(() => normalizeConfig(desk.config));
  const saved = useMemo(() => normalizeConfig(desk.config), [desk.config]);
  const dirty = JSON.stringify(local) !== JSON.stringify(saved);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    setLocal((cur) => nextSettingsDraft(cur, saved, dirtyRef.current));
  }, [saved]);
  const set = (patch: Partial<BotConfig>) => setLocal((cur) => normalizeConfig({ ...cur, ...patch }));

  return (
    <div className="space-y-4">
      <div className="neon p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-medium">Settings</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Choose how far a buy can fall before it sells, and how far it has to rise before it sells. Those levels are
              set when the buy happens. A sale does not start a new buy. Everything else is under More settings.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <button disabled={busy || !dirty} onClick={() => onSave(local)} className="btn btn-ink w-full sm:w-auto">
              {dirty ? "Save changes" : "Saved"}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                setLocal(
                  normalizeConfig({
                    ...(chain === "solana" || chain === "cronos" ? solanaDefaults() : DEFAULT_CONFIG),
                    startingEquity: local.startingEquity,
                  }),
                )
              }
              className="btn btn-ghost w-full sm:w-auto"
            >
              Reset these settings
            </button>
            <button disabled={busy} onClick={onReset} className="btn btn-ghost w-full sm:w-auto">
              Clear history
            </button>
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-[var(--faint)]">
          Checks every {local.scanSeconds}s · up to {local.maxPositions} coins at once · one loss can cost{" "}
          {local.maxRiskPerTradePct.toFixed(1)}% · stops for the day after a {local.dailyLossLimitPct}% loss · needs a score of{" "}
          {local.minConfidence}
          {local.allowMemes ? " · meme coins on" : " · meme coins off"}
          {local.oneTicketPerTick ? " · two new buys per check" : " · several new buys per check"}
          {" · "}
          {chain === "cronos" ? "WolfSwap and cro.trade" : local.venues.length ? `${local.venues.length} buy places` : "no buy places"}
          {local.walletSwaps ? " · real money" : " · practice"}
          {local.killSwitch ? " · emergency stop" : ""}
          {` · loads $${local.armFundsUsd} · $${local.buySizeUsd} a buy`}
          {chain === "cronos"
            ? ` · spends ${local.cronosQuote === "cro" ? "CRO" : "USDC"} · no extra size`
            : local.solTradeMode === "spot"
              ? " · spot swaps"
              : local.solTradeMode === "margin"
                ? ` · SOL margin${local.marginOnFourHour ? " on 4-hour setups" : ""}${local.multipliers.length ? ` · ${local.multipliers.map((n) => `${n} times`).join(", ")}` : ""}`
                : ` · spot and SOL margin${local.marginOnFourHour ? " on 4-hour setups" : ""}${local.multipliers.length ? ` · ${local.multipliers.map((n) => `${n} times`).join(", ")}` : ""}`}
        </p>
      </div>

      <Section
        title="Trading money"
        hint={
          chain === "cronos" && local.cronosQuote === "cro"
            ? "Arming loads this much CRO, at the live CRO price, onto the trading key, plus a little for fees. Practice uses the same number as pretend money. Each buy spends the size you pick."
            : "Arming loads this much USDC onto the trading key. Practice uses the same number as pretend money. Each buy spends the size you pick."
        }
      >
        {chain === "cronos" ? (
          <Pills
            label="Spend on each buy"
            hint="USDC buys with the stablecoin and sells back to USDC. CRO buys with wrapped CRO and sells back to CRO. Changing this does not flip an open ticket."
            value={local.cronosQuote}
            display={local.cronosQuote === "cro" ? "CRO" : "USDC"}
            options={[
              { value: "usdc" as const, label: "USDC" },
              { value: "cro" as const, label: "CRO" },
            ]}
            onChange={(cronosQuote) => set({ cronosQuote })}
          />
        ) : null}
        <Choice
          label="Loaded when you arm"
          hint={
            chain === "cronos" && local.cronosQuote === "cro"
              ? "25, 50, or 150 dollars of CRO. Real money moves that much CRO plus fee CRO. Practice starts a book of that size."
              : "25, 50, or 150 USDC. Real money moves that much. Practice starts a book of that size."
          }
          value={local.armFundsUsd}
          options={ARM_FUNDS_USD.map((n) => ({ value: n, label: `$${n}` }))}
          onChange={(armFundsUsd) => set({ armFundsUsd, buySizeUsd: Math.min(local.buySizeUsd, armFundsUsd) })}
        />
        <Choice
          label="Buy size per trade"
          hint="What one buy spends. It cannot be larger than the armed bankroll."
          value={local.buySizeUsd}
          options={BUY_SIZE_USD.filter((n) => n <= local.armFundsUsd).map((n) => ({ value: n, label: `$${n}` }))}
          onChange={(buySizeUsd) => set({ buySizeUsd })}
        />
      </Section>

      <Section title="Each buy" hint="These three are the main choices. The sell prices are a percent of what the buy cost.">
        <Field
          label="Sell if it falls"
          hint="Percent of the buy. A 5% drop on a $100 buy sells after a $5 loss."
          suffix="%"
          min={0.4}
          max={15}
          step={0.1}
          value={local.stopLossPct}
          onChange={(v) => set({ stopLossPct: v })}
        />
        <Field
          label="Sell if it rises"
          hint="Percent of the buy. The bot will not sell a winner until the gain is bigger than the fee to open the trade and the fee to close it."
          suffix="%"
          min={0.5}
          max={30}
          step={0.1}
          value={local.targetProfitPct}
          onChange={(v) => set({ targetProfitPct: v })}
        />
        <Field
          label="Biggest buy"
          hint="The most one real buy can spend. The starting limit is $250. Type 5 and it stays at $5."
          kind="number"
          suffix=" USD"
          min={5}
          max={10_000}
          step={1}
          value={local.maxLiveNotionalUsd}
          onChange={(v) => {
            const cap = commitTicketCap(String(v), local.maxLiveNotionalUsd);
            set({ maxLiveNotionalUsd: cap });
            if (cap !== saved.maxLiveNotionalUsd) onSave({ maxLiveNotionalUsd: cap });
          }}
        />
      </Section>

      <details className="neon p-5 sm:p-6">
        <summary className="cursor-pointer text-lg font-medium">More settings</summary>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          How often it checks, where it buys, and how big each buy can be. Save changes writes these too.
        </p>
        <div className="mt-4 space-y-4">
      <Section
        title="Real money or practice"
        hint="Practice is the normal mode. Real money asks you to type the word LIVE once when you turn it on. A refresh keeps the bot running. Turning the bot on then asks the wallet to set money aside for fees."
      >
        <Toggle
          label="Use real money"
          hint={
            local.killSwitch
              ? "The emergency stop is on. Turn real money back on from the confirm box."
              : chain === "cronos"
                ? "On sends real buys and sells from a wallet key in this browser. Off only practices, and no money moves."
                : "On sends real buys and sells from a wallet key in this browser. Off only practices, and no money moves."
          }
          checked={local.walletSwaps}
          onChange={(v) => set({ walletSwaps: v, executionMode: v ? "live" : "paper", killSwitch: v ? false : local.killSwitch })}
        />
        <Field
          label="Price wiggle room"
          hint="How far the price can move while the buy or sell goes through. 80 is about 0.80%."
          value={local.slippageBps}
          min={10}
          max={200}
          step={10}
          suffix={` · ${(local.slippageBps / 100).toFixed(2)}%`}
          onChange={(v) => set({ slippageBps: v })}
        />
        <Field
          label={chain === "cronos" ? "CRO kept for fees" : "SOL kept for fees"}
          hint="Real buys wait until the wallet has at least this much left for network fees."
          value={local.minSolForFees}
          min={0.006}
          max={0.08}
          step={0.002}
          suffix={chain === "cronos" ? " CRO" : " SOL"}
          onChange={(v) => set({ minSolForFees: v })}
        />
        <Toggle
          label="Emergency stop"
          hint="Stops new real buys and switches back to practice. You can still sell what you already hold."
          checked={local.killSwitch}
          onChange={(v) => set({ killSwitch: v, ...(v ? { walletSwaps: false, executionMode: "paper" as const } : {}) })}
        />
      </Section>

      {chain === "cronos" ? (
        <Section title="How it buys" hint={CHAIN_COPY.cronos.settingsMultiplier}>
          <p className="text-sm leading-6 text-[var(--muted)] md:col-span-2">
            {local.cronosQuote === "cro"
              ? "A buy spends CRO on WolfSwap or cro.trade. A sell turns the coin back into CRO. CRO itself is skipped so the desk does not buy CRO with CRO. There is no extra size on Cronos."
              : "A buy spends USDC on WolfSwap or cro.trade. A sell turns the coin back into USDC. There is no extra size on Cronos."}
          </p>
        </Section>
      ) : (
        <Section title="Spot or margin" hint={CHAIN_COPY.solana.settingsMultiplier}>
          <Pills
            label="How Solana trades"
            hint="Spot is a Jupiter swap. Margin is a SOL 5x or 10x perp. Both keeps swaps on the book and lets SOL use a perp."
            value={local.solTradeMode}
            display={local.solTradeMode === "spot" ? "Spot" : local.solTradeMode === "margin" ? "Margin" : "Both"}
            options={SOL_TRADE_MODES.map((mode) => ({
              value: mode,
              label: mode === "spot" ? "Spot" : mode === "margin" ? "Margin" : "Both",
            }))}
            onChange={(solTradeMode) =>
              set({
                solTradeMode,
                multipliers: multipliersForMode(solTradeMode, local.multipliers),
              })
            }
          />
          {local.solTradeMode !== "spot" ? (
            <Toggle
              label="Margin only on solid 4-hour setups"
              hint="On waits for a 4-hour structure setup before a SOL perp. A 15-minute SOL fill stays a spot swap if Both is selected."
              checked={local.marginOnFourHour}
              onChange={(marginOnFourHour) => set({ marginOnFourHour })}
            />
          ) : null}
          {local.solTradeMode === "spot" ? (
            <p className="text-sm leading-6 text-[var(--muted)] md:col-span-2">
              Every ticket is a Jupiter spot swap. SOL 5x and 10x stay off until you pick Margin or Both.
            </p>
          ) : (
            <>
              <Toggle
                label="5 times the money"
                hint={CHAIN_COPY.solana.settingsFive}
                checked={local.multipliers.includes(5)}
                onChange={(on) => {
                  const next = on ? [...local.multipliers, 5] : local.multipliers.filter((n) => n !== 5);
                  set({ multipliers: multipliersForMode(local.solTradeMode, next) });
                }}
              />
              <Toggle
                label="10 times the money"
                hint={CHAIN_COPY.solana.settingsTen}
                checked={local.multipliers.includes(10)}
                onChange={(on) => {
                  const next = on ? [...local.multipliers, 10] : local.multipliers.filter((n) => n !== 10);
                  set({ multipliers: multipliersForMode(local.solTradeMode, next) });
                }}
              />
            </>
          )}
        </Section>
      )}

      {chain === "cronos" ? (
        <Section
          title="Where it buys"
          hint={
            local.cronosQuote === "cro"
              ? "Every Cronos buy and sell quotes WolfSwap and cro.trade. The one that returns more is sent. A buy spends CRO. A sell turns the coin back into CRO."
              : "Every Cronos buy and sell quotes WolfSwap and cro.trade. The one that returns more is sent. A buy spends USDC. A sell turns the coin back into USDC."
          }
        >
          <Toggle
            label="WolfSwap"
            hint="This stays on. The quote is compared with cro.trade."
            checked
            onChange={() => {}}
          />
          <Toggle
            label="cro.trade"
            hint="This stays on. Its 0.9% fee is taken off the quote before the comparison."
            checked
            onChange={() => {}}
          />
        </Section>
      ) : (
        <Section
          title="Where it buys"
          hint="New buys only use the places you leave on. A buy you already hold stays until it sells, even if you turn that place off."
        >
          {VENUE_OPTIONS.map((venue) => (
            <Toggle
              key={venue.id}
              label={venue.label}
              hint={plainVenueHint(venue.id, venue.hint)}
              checked={local.venues.includes(venue.id)}
              onChange={(on) => {
                const venues = on ? [...local.venues, venue.id] : local.venues.filter((id) => id !== venue.id);
                set({ venues });
              }}
            />
          ))}
          {local.venues.length === 0 ? (
            <p className="text-sm text-[var(--crimson)] md:col-span-2">
              Nothing is turned on, so the next check will not buy anything.
            </p>
          ) : null}
        </Section>
      )}

      <Section title="How often it checks" hint="How often it looks for a new buy, and how many new buys one check can add.">
        <Field
          label="Check every"
          hint="While the bot is on, it looks this often. A coin you already hold is checked every 4 seconds so a sale is not left waiting."
          suffix=" seconds"
          min={4}
          max={60}
          step={1}
          value={local.scanSeconds}
          onChange={(v) => set({ scanSeconds: v })}
        />
        <Field
          label="Wait after a loss"
          hint="Minutes to wait before buying that coin again after a loss. Zero means no wait."
          suffix=" minutes"
          min={0}
          max={180}
          step={5}
          value={local.cooldownMinutes}
          onChange={(v) => set({ cooldownMinutes: v })}
        />
        <Toggle
          label="Two new buys per check"
          hint="On allows two new buys each time it checks. A third waits. Off keeps buying until a limit stops it."
          checked={local.oneTicketPerTick}
          onChange={(v) => set({ oneTicketPerTick: v })}
        />
        <Toggle
          label="Sell a buy that is going nowhere"
          hint="Sells early when the last 15 minutes turn red. Off is the tested default: in replays these early sells cost more in fees than they saved."
          checked={local.scratchEnabled}
          onChange={(v) => set({ scratchEnabled: v })}
        />
      </Section>

      <Section title="Which coins it looks at" hint="Coins that miss these checks are skipped.">
        <Field
          label="Money sitting in the pool"
          hint="Skip pools with less than this much money in them. Coins already on the watch list can pass with less."
          suffix="k"
          min={20}
          max={1000}
          step={10}
          value={local.minLiquidityUsd / 1000}
          onChange={(v) => set({ minLiquidityUsd: v * 1000 })}
        />
        <Field
          label="Traded in the last day"
          hint="Skip coins that almost nobody traded today."
          suffix="k"
          min={10}
          max={1000}
          step={10}
          value={local.minVolume24hUsd / 1000}
          onChange={(v) => set({ minVolume24hUsd: v * 1000 })}
        />
        <Field
          label="Pool has to be this old"
          hint="Hours since the pool was created. Zero allows brand new pools."
          suffix=" hours"
          min={0}
          max={72}
          step={1}
          value={local.minAgeHours}
          onChange={(v) => set({ minAgeHours: v })}
        />
        <Field
          label="How sure it has to be"
          hint="Skip a buy when the score is below this. Meme coins need a slightly higher score."
          min={50}
          max={85}
          step={1}
          value={local.minConfidence}
          onChange={(v) => set({ minConfidence: v })}
        />
        <Field
          label="Extra caution in a shaky market"
          hint="When the market looks shaky, a buy has to score at least this high."
          min={50}
          max={90}
          step={1}
          value={local.defensiveBreakoutScore}
          onChange={(v) => set({ defensiveBreakoutScore: v })}
        />
        <div className="grid gap-3">
          <Toggle
            label="Allow meme coins"
            hint="Off skips meme coins that are not already on the watch list."
            checked={local.allowMemes}
            onChange={(v) => set({ allowMemes: v })}
          />
        </div>
      </Section>

      <Section title="Safety limits" hint="How much can be at risk at the same time.">
        <Field
          label="Most coins at once"
          hint="Includes buys you made by hand."
          min={1}
          max={8}
          step={1}
          value={local.maxPositions}
          onChange={(v) => set({ maxPositions: v })}
        />
        <Field
          label="Most from one group"
          hint="Stops one kind of coin from filling the whole list."
          min={1}
          max={4}
          step={1}
          value={local.maxPerSector}
          onChange={(v) => set({ maxPerSector: v })}
        />
        <Field
          label="Pause after this many losses"
          hint="Losses in a row before new buys pause. Zero means it does not pause."
          min={0}
          max={8}
          step={1}
          value={local.lossStreakPause}
          onChange={(v) => set({ lossStreakPause: v })}
        />
        <Field
          label="Stop for the day after this loss"
          hint="New buys stop once today's loss reaches this percent of where the day started."
          suffix="%"
          min={2}
          max={15}
          step={0.5}
          value={local.dailyLossLimitPct}
          onChange={(v) => set({ dailyLossLimitPct: v })}
        />
        <Field
          label="How much of today's loss budget to use"
          hint="Stop new buys once this much of the daily loss limit is already used."
          suffix="%"
          min={50}
          max={100}
          step={5}
          value={local.dayBudgetPct}
          onChange={(v) => set({ dayBudgetPct: v })}
        />
        <Toggle
          label="Small wallets hold two coins"
          hint="Under $50, it can hold two coins. A third waits so a small wallet is not split into tiny pieces."
          checked={local.microOneTicket}
          onChange={(v) => set({ microOneTicket: v })}
        />
      </Section>

      <Section title="How big each buy is" hint="How much the next buy is allowed to spend.">
        <Field
          label="How much one loss can cost"
          hint="Percent of your balance one loss is allowed to take. A shaky market and a losing streak make this smaller."
          suffix="%"
          min={0.3}
          max={2.5}
          step={0.1}
          value={local.maxRiskPerTradePct}
          onChange={(v) => set({ maxRiskPerTradePct: v })}
        />
        <Field
          label="Cash each buy can use"
          hint={
            local.autoCash
              ? "Automatic size is on. Under $50 it may use 92% of the cash. Above that, 35%."
              : "The share of cash the next buy may use."
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
          label="Pick the size for me"
          hint="On uses 92% under $50 and 35% above that. Off uses the slider every time."
          checked={local.autoCash}
          onChange={(v) => set({ autoCash: v })}
        />
      </Section>

      <Section title="After a buy is open" hint="What happens after the sell-if-it-falls and sell-if-it-rises prices are set. The numbers are how many times your allowed loss the price has moved in your favor. 1 means the gain matches the loss you were willing to take.">
        <Field
          label="Protect a small gain after"
          hint="Once the gain reaches this many times your allowed loss, the sell-if-it-falls price moves up to a small gain."
          suffix="×"
          min={0.3}
          max={2}
          step={0.05}
          value={local.beR}
          onChange={(v) => set({ beR: v })}
        />
        <Field
          label="Sell part of a winner after"
          hint="Sell some of a winner once the gain reaches this many times your allowed loss."
          suffix="×"
          min={0.5}
          max={3}
          step={0.05}
          value={local.scaleAtR}
          onChange={(v) => set({ scaleAtR: v })}
        />
        <Field
          label="How much of the winner to sell"
          hint="Percent of the buy to sell when it takes that partial profit."
          suffix="%"
          min={25}
          max={75}
          step={5}
          value={local.scaleFractionPct}
          onChange={(v) => set({ scaleFractionPct: v })}
        />
        <Field
          label="Lock in profit after"
          hint="Once the gain reaches this many times your allowed loss, the sell price locks in a gain."
          suffix="×"
          min={1}
          max={4}
          step={0.1}
          value={local.lockAtR}
          onChange={(v) => set({ lockAtR: v })}
        />
        <Field
          label="How much profit to lock in"
          hint="The gain that stays protected after the lock, in times your allowed loss."
          suffix="×"
          min={0.05}
          max={1.5}
          step={0.05}
          value={local.lockProfitR}
          onChange={(v) => set({ lockProfitR: v })}
        />
        <Field
          label="Sell if nothing happens"
          hint="Sell a normal coin that is still barely up after this many minutes."
          suffix=" minutes"
          min={10}
          max={240}
          step={5}
          value={local.staleMin}
          onChange={(v) => set({ staleMin: v })}
        />
        <Field
          label="Same rule for meme coins"
          hint="Sell a meme coin that is still barely up after this many minutes."
          suffix=" minutes"
          min={8}
          max={120}
          step={1}
          value={local.memeStaleMin}
          onChange={(v) => set({ memeStaleMin: v })}
        />
        <Field
          label="Sell after this long"
          hint="Sell a normal coin after this many minutes, even if it is working."
          suffix=" minutes"
          min={30}
          max={360}
          step={10}
          value={local.timeCapMin}
          onChange={(v) => set({ timeCapMin: v })}
        />
        <Field
          label="Sell meme coins after"
          hint="Sell a meme coin after this many minutes, even if it is working."
          suffix=" minutes"
          min={10}
          max={180}
          step={5}
          value={local.memeTimeCapMin}
          onChange={(v) => set({ memeTimeCapMin: v })}
        />
      </Section>
        </div>
      </details>

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

function plainVenueHint(id: string, fallback: string): string {
  const hints: Record<string, string> = {
    raydium: "Buys can use Raydium.",
    orca: "Buys can use Orca.",
    meteora: "Buys can use Meteora.",
    jupiter: "Buys can use Jupiter. The trade still settles on Raydium, Orca, or Meteora.",
    pump: "Buys can use Pump.fun coins.",
    other: "Buys can use any other pool, including Phoenix and Lifinity.",
  };
  return hints[id] ?? fallback;
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
  kind = "range",
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
  kind?: "range" | "number";
  onChange: (value: number) => void;
}) {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const shown = digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
  const [draft, setDraft] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);
  const commitDraft = () => {
    focused.current = false;
    const text = draft.trim();
    const next = text ? Number(text) : Number.NaN;
    if (!Number.isFinite(next)) {
      setDraft(shown);
      return;
    }
    const resolved = Math.min(max, Math.max(min, next));
    const printed = digits === 0 ? String(Math.round(resolved)) : resolved.toFixed(digits);
    setDraft(printed);
    if (resolved !== value) onChange(resolved);
  };
  return (
    <label className={`block rounded-2xl border border-[var(--line)] bg-black/20 p-3 ${disabled ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="min-w-0">{label}</span>
        <span className="num shrink-0 text-[var(--magenta)]">
          {shown}
          {suffix ?? ""}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--faint)]">{hint}</p>
      {kind === "number" ? (
        <input
          type="number"
          inputMode="decimal"
          className="num mt-3 w-full rounded-xl border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          min={min}
          max={max}
          step={step}
          value={focused.current ? draft : shown}
          disabled={disabled}
          onFocus={() => {
            focused.current = true;
            setDraft(shown);
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
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
      )}
    </label>
  );
}

function Choice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  options: { value: number; label: string }[];
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-black/20 p-3">
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="min-w-0">{label}</span>
        <span className="num shrink-0 text-[var(--magenta)]">${value}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--faint)]">{hint}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`num rounded-full px-3 py-1 text-[12px] ${on ? "bg-[var(--magenta)] text-[var(--accent-ink)]" : "border border-[var(--line)] text-[var(--muted)]"}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Pills<T extends string>({
  label,
  hint,
  value,
  options,
  display,
  onChange,
}: {
  label: string;
  hint: string;
  value: T;
  options: { value: T; label: string }[];
  display?: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-black/20 p-3">
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="min-w-0">{label}</span>
        <span className="num shrink-0 text-[var(--magenta)]">{display ?? value}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--faint)]">{hint}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`num inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] ${on ? "bg-[var(--magenta)] text-[var(--accent-ink)]" : "border border-[var(--line)] text-[var(--muted)]"}`}
            >
              {option.label === "USDC" || option.label === "CRO" || option.label === "SOL" ? (
                <TokenLogo symbol={option.label} size="xs" />
              ) : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
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
        className={`num mt-0.5 shrink-0 rounded-full px-2 py-1 text-[11px] ${checked ? "bg-[var(--magenta)] text-[var(--accent-ink)]" : "border border-[var(--line)] text-[var(--muted)]"}`}
      >
        {checked ? "On" : "Off"}
      </span>
    </button>
  );
}
