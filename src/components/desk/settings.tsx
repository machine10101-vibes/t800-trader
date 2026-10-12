"use client";

import { CHAIN_COPY, isSpotDesk, type ChainId } from "@/lib/chain";
import { ARM_FUNDS_USD, BUY_SIZE_USD, commitTicketCap, logicFramesRule, multipliersForMode, nextSettingsDraft, SOL_TRADE_MODES, toggleLogicFrame, type RuleId } from "@/lib/deskSettings";
import { FRAME_LABEL, FRAMES, type Frame } from "@/lib/market/frames";
import { venueOptionsFor, venueSummary, venuesOnFor } from "@/lib/market/venues";
import { normalizeConfig, solanaDefaults } from "@/lib/store";
import type { BotConfig, DeskPayload } from "@/lib/types";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TokenLogo, VenueLogo } from "./TokenLogo";

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
  const setRule = (id: RuleId, on: boolean) =>
    setLocal((cur) => normalizeConfig({ ...cur, rulesOn: { ...cur.rulesOn, [id]: on } }));
  const rulesOff = Object.values(local.rulesOn).filter((on) => !on).length;

  return (
    <div className="space-y-4">
      <div className="neon p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-medium">Settings</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Choose how far a buy can fall before it sells, and how far it has to rise before it sells. Those levels are
              set when the buy happens. Every number below can also be turned off. Off skips that rule and keeps the
              number for when you turn it back on. A sale does not start a new buy. Everything else is under More settings.
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
                    ...solanaDefaults(),
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
          {venueSummary(local.venues, chain)}
          {local.walletSwaps ? " · real money" : " · practice"}
          {local.killSwitch ? " · emergency stop" : ""}
          {` · loads $${local.armFundsUsd} · $${local.buySizeUsd} a buy`}
          {` · charts ${local.logicFrames.join(", ")}`}
          {rulesOff ? ` · ${rulesOff} ${rulesOff === 1 ? "rule" : "rules"} off` : " · every rule on"}
          {chain === "cronos"
            ? ` · spends ${local.cronosQuote === "cro" ? "CRO" : "USDC"} · no extra size`
            : chain === "dash"
              ? ` · spends ${local.dashQuote === "dash" ? "DASH" : "USDT"} · no extra size`
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
            : chain === "dash" && local.dashQuote === "dash"
              ? "Arming uses this much DASH, at the live DASH price, on the NEAR account. Practice uses the same number as pretend money. Each buy spends the size you pick."
              : chain === "dash"
                ? "Arming uses this much USDT on the NEAR account. Practice uses the same number as pretend money. Each buy spends the size you pick."
                : "Arming loads this much USDC onto the trading key. Practice uses the same number as pretend money. Each buy spends the size you pick."
        }
      >
        {chain === "dash" ? (
          <Pills
            label="Spend on each buy"
            hint="USDT buys with the stablecoin and sells back to USDT. DASH buys with DASH and sells back to DASH. DASH itself is skipped when the desk spends DASH. Changing this does not flip an open ticket."
            value={local.dashQuote}
            display={local.dashQuote === "dash" ? "DASH" : "USDT"}
            options={[
              { value: "usdt" as const, label: "USDT" },
              { value: "dash" as const, label: "DASH" },
            ]}
            onChange={(dashQuote) => set({ dashQuote })}
          />
        ) : chain === "cronos" ? (
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
              : chain === "dash" && local.dashQuote === "dash"
                ? "25, 50, or 150 dollars of DASH. Real money spends that much DASH. Practice starts a book of that size."
                : chain === "dash"
                  ? "25, 50, or 150 USDT. Real money spends that much. Practice starts a book of that size."
                  : "25, 50, or 150 USDC. Real money moves that much. Practice starts a book of that size."
          }
          value={local.armFundsUsd}
          options={ARM_FUNDS_USD.map((n) => ({ value: n, label: `$${n}` }))}
          enabled={local.rulesOn.armFunds}
          onToggle={(on) => setRule("armFunds", on)}
          onChange={(armFundsUsd) => set({ armFundsUsd, buySizeUsd: Math.min(local.buySizeUsd, armFundsUsd) })}
        />
        <Choice
          label="Buy size per trade"
          hint="What one buy spends. It cannot be larger than the armed bankroll. Off uses $10, or the armed bankroll if that is smaller."
          value={local.buySizeUsd}
          options={BUY_SIZE_USD.filter((n) => n <= local.armFundsUsd).map((n) => ({ value: n, label: `$${n}` }))}
          enabled={local.rulesOn.buySize}
          onToggle={(on) => setRule("buySize", on)}
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
          enabled={local.rulesOn.stopLoss}
          onToggle={(on) => setRule("stopLoss", on)}
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
          enabled={local.rulesOn.targetProfit}
          onToggle={(on) => setRule("targetProfit", on)}
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
          enabled={local.rulesOn.maxNotional}
          onToggle={(on) => setRule("maxNotional", on)}
          onChange={(v) => {
            const cap = commitTicketCap(String(v), local.maxLiveNotionalUsd);
            set({ maxLiveNotionalUsd: cap });
            if (cap !== saved.maxLiveNotionalUsd) onSave({ maxLiveNotionalUsd: cap });
          }}
        />
      </Section>

      <Section
        title="Charts the bot uses"
        hint="Turn each chart on or off. The shortest chart that is on finds the buy. Longer charts that stay on must not fight that buy. At least one chart stays on. This is the same on Solana, Cronos, and Dash."
      >
        {FRAMES.map((frame) => (
          <Toggle
            key={frame}
            label={`${FRAME_LABEL[frame]} chart`}
            hint={logicChartHint(frame, local.logicFrames, chain)}
            checked={local.logicFrames.includes(frame)}
            onChange={(on) => set({ logicFrames: toggleLogicFrame(local.logicFrames, frame, on) })}
          />
        ))}
        <p className="text-sm leading-6 text-[var(--muted)] md:col-span-2">{logicFramesRule(local.logicFrames)}</p>
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
              : chain === "dash"
                ? "On sends real buys and sells through the NEAR DEX. NEAR Mobile signs each one. Off only practices, and no money moves."
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
          enabled={local.rulesOn.slippage}
          onToggle={(on) => setRule("slippage", on)}
          onChange={(v) => set({ slippageBps: v })}
        />
        <Field
          label={chain === "dash" ? "NEAR kept for fees" : chain === "cronos" ? "CRO kept for fees" : "SOL kept for fees"}
          hint="On waits until the wallet has at least this much left for network fees. Off uses the smaller built-in cushion."
          value={local.minSolForFees}
          enabled={local.rulesOn.feeReserve}
          onToggle={(on) => setRule("feeReserve", on)}
          min={0.006}
          max={0.08}
          step={0.002}
          suffix={chain === "dash" ? " NEAR" : chain === "cronos" ? " CRO" : " SOL"}
          onChange={(v) => set({ minSolForFees: v })}
        />
        <Toggle
          label="Emergency stop"
          hint="Stops new real buys and switches back to practice. You can still sell what you already hold."
          checked={local.killSwitch}
          onChange={(v) => set({ killSwitch: v, ...(v ? { walletSwaps: false, executionMode: "paper" as const } : {}) })}
        />
      </Section>

      {isSpotDesk(chain) ? (
        <Section title="How it buys" hint={CHAIN_COPY[chain].settingsMultiplier}>
          <p className="text-sm leading-6 text-[var(--muted)] md:col-span-2">
            {chain === "dash"
              ? local.dashQuote === "dash"
                ? "A buy spends DASH on the NEAR DEX. A sell turns the coin back into DASH. DASH itself is skipped so the desk does not buy DASH with DASH. There is no extra size on Dash."
                : "A buy spends USDT on the NEAR DEX. A sell turns the coin back into USDT. There is no extra size on Dash."
              : local.cronosQuote === "cro"
                ? "A buy spends CRO on the DEXes you leave on. A sell turns the coin back into CRO. CRO itself is skipped so the desk does not buy CRO with CRO. There is no extra size on Cronos."
                : "A buy spends USDC on the DEXes you leave on. A sell turns the coin back into USDC. There is no extra size on Cronos."}
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
              hint={
                local.logicFrames.includes("4h")
                  ? "On waits for a 4-hour structure setup before a SOL perp. A shorter-chart SOL fill stays a spot swap if Both is selected."
                  : "Turn the 4-hour chart on above if you want SOL margin to wait for that setup."
              }
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

      <Section
        title="Where it buys"
        hint={
          chain === "dash"
            ? local.dashQuote === "dash"
              ? "The NEAR DEX stays on or off. A buy spends DASH. A ticket you already hold still sells if you turn it off."
              : "The NEAR DEX stays on or off. A buy spends USDT. A ticket you already hold still sells if you turn it off."
            : chain === "cronos"
              ? local.cronosQuote === "cro"
                ? "Turn each DEX on or off. A buy or sell quotes the places that are on and sends the one that returns more. A buy spends CRO. A ticket you already hold still sells if you turn that place off."
                : "Turn each DEX on or off. A buy or sell quotes the places that are on and sends the one that returns more. A buy spends USDC. A ticket you already hold still sells if you turn that place off."
              : "New buys only use the places you leave on. A buy you already hold stays until it sells, even if you turn that place off."
        }
      >
        {venueOptionsFor(chain).map((venue) => {
          const on = venuesOnFor(local.venues, chain).includes(venue.id);
          return (
            <Toggle
              key={venue.id}
              label={venue.label}
              hint={plainVenueHint(venue.id, venue.hint)}
              mark={<VenueLogo id={venue.id} size="md" />}
              checked={on}
              onChange={(next) => {
                if (isSpotDesk(chain)) {
                  const current = venuesOnFor(local.venues, chain);
                  set({
                    venues: next ? [...current, venue.id] : current.filter((id) => id !== venue.id),
                  });
                  return;
                }
                const venues = next ? [...local.venues, venue.id] : local.venues.filter((id) => id !== venue.id);
                set({ venues });
              }}
            />
          );
        })}
        {venuesOnFor(local.venues, chain).length === 0 ? (
          <p className="text-sm text-[var(--crimson)] md:col-span-2">
            Nothing is turned on, so the next check will not buy anything.
          </p>
        ) : null}
      </Section>

      <Section title="How often it checks" hint="How often it looks for a new buy, and how many new buys one check can add.">
        <Field
          label="Check every"
          hint="While the bot is on, it looks this often. A coin you already hold is checked every 4 seconds so a sale is not left waiting."
          suffix=" seconds"
          min={4}
          max={60}
          step={1}
          value={local.scanSeconds}
          enabled={local.rulesOn.scan}
          onToggle={(on) => setRule("scan", on)}
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
          enabled={local.rulesOn.cooldown}
          onToggle={(on) => setRule("cooldown", on)}
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
          enabled={local.rulesOn.liquidity}
          onToggle={(on) => setRule("liquidity", on)}
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
          enabled={local.rulesOn.volume}
          onToggle={(on) => setRule("volume", on)}
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
          enabled={local.rulesOn.poolAge}
          onToggle={(on) => setRule("poolAge", on)}
          onChange={(v) => set({ minAgeHours: v })}
        />
        <Field
          label="How sure it has to be"
          hint="Skip a buy when the score is below this. Meme coins need a slightly higher score."
          min={50}
          max={85}
          step={1}
          value={local.minConfidence}
          enabled={local.rulesOn.confidence}
          onToggle={(on) => setRule("confidence", on)}
          onChange={(v) => set({ minConfidence: v })}
        />
        <Field
          label="Extra caution in a shaky market"
          hint="When the market looks shaky, a buy has to score at least this high."
          min={50}
          max={90}
          step={1}
          value={local.defensiveBreakoutScore}
          enabled={local.rulesOn.defensiveScore}
          onToggle={(on) => setRule("defensiveScore", on)}
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
          enabled={local.rulesOn.maxPositions}
          onToggle={(on) => setRule("maxPositions", on)}
          onChange={(v) => set({ maxPositions: v })}
        />
        <Field
          label="Most from one group"
          hint="Stops one kind of coin from filling the whole list."
          min={1}
          max={4}
          step={1}
          value={local.maxPerSector}
          enabled={local.rulesOn.maxPerSector}
          onToggle={(on) => setRule("maxPerSector", on)}
          onChange={(v) => set({ maxPerSector: v })}
        />
        <Field
          label="Pause after this many losses"
          hint="Losses in a row before new buys pause. Zero means it does not pause."
          min={0}
          max={8}
          step={1}
          value={local.lossStreakPause}
          enabled={local.rulesOn.lossStreak}
          onToggle={(on) => setRule("lossStreak", on)}
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
          enabled={local.rulesOn.dailyLoss}
          onToggle={(on) => setRule("dailyLoss", on)}
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
          enabled={local.rulesOn.dayBudget}
          onToggle={(on) => setRule("dayBudget", on)}
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
          enabled={local.rulesOn.riskPerTrade}
          onToggle={(on) => setRule("riskPerTrade", on)}
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
          enabled={local.rulesOn.protectGain}
          onToggle={(on) => setRule("protectGain", on)}
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
          enabled={local.rulesOn.scaleOut}
          onToggle={(on) => setRule("scaleOut", on)}
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
          enabled={local.rulesOn.scaleOut}
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
          enabled={local.rulesOn.lockProfit}
          onToggle={(on) => setRule("lockProfit", on)}
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
          enabled={local.rulesOn.lockProfit}
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
          enabled={local.rulesOn.staleExit}
          onToggle={(on) => setRule("staleExit", on)}
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
          enabled={local.rulesOn.memeStale}
          onToggle={(on) => setRule("memeStale", on)}
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
          enabled={local.rulesOn.timeCap}
          onToggle={(on) => setRule("timeCap", on)}
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
          enabled={local.rulesOn.memeTimeCap}
          onToggle={(on) => setRule("memeTimeCap", on)}
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

function logicChartHint(frame: Frame, enabled: Frame[], chain: ChainId): string {
  const on = enabled.includes(frame);
  if (frame === "5m") {
    return on
      ? "On. This is the fastest chart. If it is the shortest one left on, it finds the buy."
      : "Off. Turn it on if you want the bot to hunt on the 5-minute chart.";
  }
  if (frame === "15m") {
    return on
      ? "On. This is the usual entry chart. If a shorter chart is also on, this one back-checks that buy."
      : "Off. The bot will not use the 15-minute chart until you turn it back on.";
  }
  if (frame === "1h") {
    return on
      ? "On. A buy must not fight the 1-hour trend."
      : "Off. The bot will not wait for the 1-hour chart.";
  }
  return on
    ? chain === "solana"
      ? "On. A buy must not fight the 4-hour trend. SOL margin can also wait for a setup on this chart."
      : "On. A buy must not fight the 4-hour trend."
    : "Off. The bot will not wait for the 4-hour chart.";
}

function plainVenueHint(id: string, fallback: string): string {
  const hints: Record<string, string> = {
    raydium: "On lets new buys use Raydium.",
    orca: "On lets new buys use Orca.",
    meteora: "On lets new buys use Meteora.",
    jupiter: "On lets new buys use Jupiter. The trade still settles on Raydium, Orca, or Meteora.",
    pump: "On lets new buys use Pump.fun coins.",
    other: "On lets new buys use any other pool, including Phoenix and Lifinity.",
    wolfswap: "On quotes WolfSwap and can send that swap when it returns the most.",
    vvs: "On quotes VVS Finance and can send that swap when it returns the most.",
    crotrade: "On quotes cro.trade after its 0.9% fee and can send that swap when it returns the most.",
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
  enabled = true,
  kind = "range",
  onChange,
  onToggle,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
  enabled?: boolean;
  kind?: "range" | "number";
  onChange: (value: number) => void;
  onToggle?: (on: boolean) => void;
}) {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const shown = digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
  const [draft, setDraft] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);
  const off = enabled === false || disabled;
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
    <div className={`block rounded-2xl border border-[var(--line)] bg-black/20 p-3 ${off ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="min-w-0">{label}</span>
        <span className="flex shrink-0 items-center gap-2">
          {onToggle ? (
            <button
              type="button"
              onClick={() => onToggle(!enabled)}
              className={`num rounded-full px-2 py-1 text-[11px] ${enabled ? "bg-[var(--magenta)] text-[var(--accent-ink)]" : "border border-[var(--line)] text-[var(--muted)]"}`}
            >
              {enabled ? "On" : "Off"}
            </button>
          ) : null}
          <span className="num text-[var(--magenta)]">
            {shown}
            {suffix ?? ""}
          </span>
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
          disabled={off}
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
          disabled={off}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
    </div>
  );
}

function Choice({
  label,
  hint,
  value,
  options,
  enabled = true,
  onChange,
  onToggle,
}: {
  label: string;
  hint: string;
  value: number;
  options: { value: number; label: string }[];
  enabled?: boolean;
  onChange: (value: number) => void;
  onToggle?: (on: boolean) => void;
}) {
  return (
    <div className={`rounded-2xl border border-[var(--line)] bg-black/20 p-3 ${enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="min-w-0">{label}</span>
        <span className="flex shrink-0 items-center gap-2">
          {onToggle ? (
            <button
              type="button"
              onClick={() => onToggle(!enabled)}
              className={`num rounded-full px-2 py-1 text-[11px] ${enabled ? "bg-[var(--magenta)] text-[var(--accent-ink)]" : "border border-[var(--line)] text-[var(--muted)]"}`}
            >
              {enabled ? "On" : "Off"}
            </button>
          ) : null}
          <span className="num text-[var(--magenta)]">${value}</span>
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--faint)]">{hint}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={!enabled}
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
  mark,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  mark?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--line)] bg-black/20 p-3 text-left"
    >
      <span className="flex min-w-0 items-start gap-3">
        {mark}
        <span className="min-w-0">
          <span className="block text-sm">{label}</span>
          <span className="mt-1 block text-xs leading-5 text-[var(--faint)]">{hint}</span>
        </span>
      </span>
      <span
        className={`num mt-0.5 shrink-0 rounded-full px-2 py-1 text-[11px] ${checked ? "bg-[var(--magenta)] text-[var(--accent-ink)]" : "border border-[var(--line)] text-[var(--muted)]"}`}
      >
        {checked ? "On" : "Off"}
      </span>
    </button>
  );
}
