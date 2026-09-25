"use client";

import { CandleChart, EquityPath, ScatterTape, VolumeBars } from "@/components/desk/charts";
import { SettingsPanel } from "@/components/desk/settings";
import { WatchScreen } from "@/components/desk/watch";
import { CHAIN_COPY, tapeLabel, txUrl, type ChainId } from "@/lib/chain";
import {
  adoptLiveEquity,
  armButton,
  attachWallet,
  baselineTradingPrincipal,
  cancelResting,
  closeTicket,
  configureBot,
  controlBot,
  detachWallet,
  loadDesk,
  shellDesk,
  tradingProfitUsd,
  tradingSnapshot,
  withdrawTradingProfit,
} from "@/lib/client";
import { listLocalBooks } from "@/lib/store";
import { parseWalletAddress } from "@/lib/monitor";
import { fetchOhlcv } from "@/lib/market/providers";
import { bookTokens } from "@/lib/market/universe";
import { assetCall } from "@/lib/market/tape";
import { venueForDex, venueLabel } from "@/lib/market/venues";
import { connectDesk, detectedDeskWallet, disconnectDesk, listenDesk, refreshDesk, type DeskSession } from "@/lib/chains/session";
import { forgetPhantomApproval, injectedSolanaAddress, isOpenPhantomApp, resumeStage } from "@/lib/solana/wallet";
import type { BotConfig, Candle, DeskPayload, Position, ResearchThesis, TapeCard } from "@/lib/types";
import { pct, priceFmt, shortAddress, usd } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MIN_TRADE_USD, rMultiple } from "@/lib/trading/risk";
import { bookStats } from "@/lib/trading/stats";
import { Label, Money, Pill, Px, ScoreRing, Spark, Stat, Tone } from "./bits";

type Tab = "overview" | "radar" | "bot" | "book" | "risk";

const NAV: { id: Tab; label: string; kicker: string }[] = [
  { id: "overview", label: "Overview", kicker: "01" },
  { id: "radar", label: "Radar", kicker: "02" },
  { id: "bot", label: "Bot", kicker: "03" },
  { id: "book", label: "Book", kicker: "04" },
  { id: "risk", label: "Options", kicker: "05" },
];

export function DeskApp() {
  const [view, setView] = useState<ChainId>("solana");
  const [running, setRunning] = useState<Record<ChainId, boolean>>({ solana: false, cronos: false });
  const markRunning = useCallback((chain: ChainId, next: boolean) => {
    setRunning((cur) => (cur[chain] === next ? cur : { ...cur, [chain]: next }));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.desk = view;
  }, [view]);
  return (
    <>
      <div hidden={view !== "solana"}>
        <ChainDesk
          chain="solana"
          active={view === "solana"}
          peerArmed={running.cronos}
          onRunning={(next) => markRunning("solana", next)}
          onSwitch={setView}
        />
      </div>
      <div hidden={view !== "cronos"} className="theme-cronos">
        <ChainDesk
          chain="cronos"
          active={view === "cronos"}
          peerArmed={running.solana}
          onRunning={(next) => markRunning("cronos", next)}
          onSwitch={setView}
        />
      </div>
    </>
  );
}

function ChainDesk({
  chain,
  active,
  peerArmed,
  onRunning,
  onSwitch,
}: {
  chain: ChainId;
  active: boolean;
  peerArmed: boolean;
  onRunning: (running: boolean) => void;
  onSwitch: (next: ChainId) => void;
}) {
  const copy = CHAIN_COPY[chain];
  const [tab, setTab] = useState<Tab>("overview");
  const [wallet, setWallet] = useState<DeskSession | null>(null);
  const [trading, setTrading] = useState<Awaited<ReturnType<typeof tradingSnapshot>>>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(false);
  const [thesis, setThesis] = useState<ResearchThesis | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<{ id: string; message: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [clock, setClock] = useState("");
  const [focusMint, setFocusMint] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [walletHint, setWalletHint] = useState<string | null>(null);
  const [resume, setResume] = useState<0 | 1 | 2>(0);
  const [phone, setPhone] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const [watchAddress, setWatchAddress] = useState<string | null>(null);
  const [watchDraft, setWatchDraft] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);
  const [knownBooks, setKnownBooks] = useState<string[]>([]);
  const lastTradeId = useRef<string | null>(null);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const busyRef = useRef(false);

  const openWatch = useCallback((raw: string) => {
    const parsed = chain === "cronos" ? parseCronosAddress(raw) : parseWalletAddress(raw);
    if (!parsed) {
      setWatchError(copy.watchError);
      return;
    }
    setWatchError(null);
    setWatchAddress(parsed);
    const url = new URL(window.location.href);
    url.searchParams.set("watch", parsed);
    window.history.replaceState(null, "", url);
  }, [chain, copy.watchError]);

  const closeWatch = useCallback(() => {
    setWatchAddress(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("watch");
    window.history.replaceState(null, "", url);
  }, []);

  const applyDesk = useCallback((next: DeskPayload) => {
    setDesk(next);
    setError(null);
    setUpdatedAt(next.generatedAt);
    setThesis((cur) => (cur ? next.research.find((r) => r.id === cur.id) ?? cur : null));
    setFocusMint((cur) => {
      if (cur && next.research.some((r) => r.candidate.mint === cur)) return cur;
      return next.research[0]?.candidate.mint ?? null;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    try {
      applyDesk(await loadDesk(false, chain));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Desk refresh failed");
    } finally {
      setBooting(false);
    }
  }, [applyDesk, chain, wallet]);

  const connect = useCallback(async (trusted = false) => {
    setWalletBusy(true);
    setWalletError(null);
    try {
      const session = await connectDesk(chain, trusted);
      const book = await attachWallet(session.address, session.equityUsd, chain);
      applyDesk(shellDesk(book));
      setWallet(session);
      setBooting(false);
      try {
        const note = sessionStorage.getItem("t800-phantom-sign-note");
        if (note) {
          sessionStorage.removeItem("t800-phantom-sign-note");
          setError(note);
        }
      } catch {
        // The desk is open either way.
      }
    } catch (e) {
      if (!trusted && isOpenPhantomApp(e)) {
        window.location.assign(e.browseUrl);
        return;
      }
      const message = e instanceof Error ? e.message : "Wallet connect failed";
      const balanceMiss = /balance read|refused the balance/i.test(message);
      const phantomBack = /phantom/i.test(message);
      if (!trusted || balanceMiss || phantomBack) setWalletError(message);
    } finally {
      setWalletBusy(false);
    }
  }, [applyDesk, chain]);

  const disconnect = useCallback(async () => {
    if (chain === "solana") forgetPhantomApproval();
    await disconnectDesk(chain, wallet);
    detachWallet(chain);
    setWallet(null);
    setTrading(null);
    setDesk(null);
    setThesis(null);
    setError(null);
    setBooting(false);
  }, [chain, wallet]);

  useEffect(() => {
    setWalletHint(detectedDeskWallet(chain));
    setResume(chain === "solana" ? resumeStage(window.location.href) : 0);
    setPhone(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia("(max-width: 639px)").matches);
  }, [chain]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("watch");
    const parsed = chain === "cronos" ? parseCronosAddress(query ?? "") : query ? parseWalletAddress(query) : null;
    if (parsed) return;
    void connect(true);
  }, [chain, connect]);

  useEffect(() => {
    if (chain !== "solana") return;
    const resume = () => {
      if (walletRef.current) return;
      if (document.visibilityState === "hidden") return;
      void connect(true);
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, [chain, connect]);

  useEffect(() => {
    if (chain !== "solana") return;
    let cancelled = false;
    const id = window.setInterval(() => {
      if (cancelled || walletRef.current) return;
      if (!injectedSolanaAddress()) return;
      cancelled = true;
      window.clearInterval(id);
      void connect(true);
    }, 400);
    const stop = window.setTimeout(() => window.clearInterval(id), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [chain, connect]);

  useEffect(() => {
    if (!wallet) return;
    return listenDesk(chain, wallet, {
      onDisconnect: () => {
        detachWallet(chain);
        setWallet(null);
        setTrading(null);
        setDesk(null);
      },
      onAccountChanged: (address) => {
        if (!address) {
          void disconnect();
          return;
        }
        void (async () => {
          detachWallet(chain);
          const session = await refreshDesk(chain, { ...wallet, address });
          const book = await attachWallet(session.address, session.equityUsd, chain);
          applyDesk(shellDesk(book));
          setWallet(session);
          setBooting(false);
        })();
      },
    });
  }, [applyDesk, chain, disconnect, wallet]);

  useEffect(() => {
    if (!wallet) return;
    void refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh, wallet]);

  useEffect(() => {
    if (!wallet) return;
    let live = true;
    const pullTrading = () => {
      void tradingSnapshot(wallet.address, chain)
        .then(async (snap) => {
          if (!live) return;
          setTrading(snap);
          if (!snap) return;
          const wrote = await baselineTradingPrincipal(snap.equityUsd, chain);
          if (wrote && live) applyDesk(await loadDesk(false, chain));
        })
        .catch(() => undefined);
    };
    pullTrading();
    const id = setInterval(() => {
      void refreshDesk(chain, wallet)
        .then(async (session) => {
          setWallet(session);
          await attachWallet(session.address, session.equityUsd, chain);
          pullTrading();
        })
        .catch(() => undefined);
    }, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [applyDesk, chain, wallet]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("watch");
    if (query) {
      const parsed = chain === "cronos" ? parseCronosAddress(query) : parseWalletAddress(query);
      if (parsed) setWatchAddress(parsed);
    }
    setKnownBooks(listLocalBooks(chain));
  }, [chain]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const scanSecondsRef = useRef(8);
  scanSecondsRef.current = Math.max(6, desk?.config.scanSeconds ?? 8);

  useEffect(() => {
    if (!walletRef.current) return;
    let cancel = false;
    let inflight = false;
    const run = async () => {
      const current = walletRef.current;
      if (!current || cancel || inflight || busyRef.current) return false;
      inflight = true;
      try {
        const next = await controlBot("tick", current, chain);
        if (!cancel) applyDesk(next);
        return true;
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : "Tick failed");
        return false;
      } finally {
        inflight = false;
      }
    };
    const first = window.setInterval(() => {
      if (cancel || busyRef.current) return;
      window.clearInterval(first);
      void run();
    }, 300);
    const id = window.setInterval(() => void run(), scanSecondsRef.current * 1000);
    return () => {
      cancel = true;
      window.clearInterval(first);
      window.clearInterval(id);
    };
  }, [applyDesk, chain, wallet?.address]);

  const onRunningRef = useRef(onRunning);
  onRunningRef.current = onRunning;
  useEffect(() => {
    onRunningRef.current(Boolean(desk?.bot.running));
  }, [desk?.bot.running]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        setThesis(null);
        setDetailId(null);
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key >= "1" && e.key <= "5") {
        const next = NAV[Number(e.key) - 1];
        if (next) {
          setTab(next.id);
          setThesis(null);
        }
        return;
      }
      if (e.key.toLowerCase() === "r" && wallet) {
        e.preventDefault();
        void refresh();
        return;
      }
      if (e.key.toLowerCase() === "f" && wallet && desk) {
        e.preventDefault();
        void control("flatten");
        return;
      }
      if (e.code !== "Space" || e.repeat || !wallet || !desk) return;
      e.preventDefault();
      void control(desk.bot.running ? "stop" : "start");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, desk?.bot.running, wallet, refresh]);

  useEffect(() => {
    const rows = desk?.config.walletSwaps ? desk.trades.filter((trade) => trade.signature) : desk?.trades;
    const latest = rows?.[0];
    if (!latest) return;
    if (lastTradeId.current === null) {
      lastTradeId.current = latest.id;
      return;
    }
    if (latest.id === lastTradeId.current) return;
    lastTradeId.current = latest.id;
    const text = `${latest.signature ? "WALLET" : "SIM"} ${latest.action.toUpperCase()} ${latest.symbol} ${latest.reason}${latest.pnlUsd !== null ? ` ${usd(latest.pnlUsd)}` : ""}`;
    setToasts((cur) => [...cur, { id: latest.id, text }].slice(-4));
    window.setTimeout(() => {
      setToasts((cur) => cur.filter((t) => t.id !== latest.id));
    }, 4200);
  }, [desk?.config.walletSwaps, desk?.trades]);

  const control = async (action: "start" | "stop" | "reset" | "tick" | "flatten") => {
    if (!wallet) {
      setError(copy.needWallet);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      if (action === "start" || action === "reset") {
        const session = await refreshDesk(chain, wallet);
        setWallet(session);
        if (action === "start" && session.equityUsd < MIN_TRADE_USD) {
          const funded = await tradingSnapshot(session.address, chain);
          if (!funded || funded.equityUsd < MIN_TRADE_USD) {
            setError(`Wallet needs at least $${MIN_TRADE_USD} of ${copy.needFunds} to trade.`);
            return;
          }
        }
        if (action === "start") await attachWallet(session.address, Math.max(session.equityUsd, trading?.equityUsd ?? 0), chain);
        applyDesk(await controlBot(action, session, chain));
        setTrading(await tradingSnapshot(session.address, chain).catch(() => null));
        if (action === "reset") {
          await adoptLiveEquity(session.equityUsd, chain);
          const next = await loadDesk(false, chain);
          applyDesk(next);
          if (next.portfolio.equityUsd < MIN_TRADE_USD) {
            setError(`Wallet needs at least $${MIN_TRADE_USD} of ${copy.needFunds} to trade.`);
          }
        }
        return;
      }
      applyDesk(await controlBot(action, wallet, chain));
      setTrading(await tradingSnapshot(wallet.address, chain).catch(() => null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Control failed");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const withdrawProfit = async () => {
    if (!wallet) {
      setError(copy.needWallet);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      applyDesk(await withdrawTradingProfit(wallet, chain));
      const [session, snap] = await Promise.all([
        refreshDesk(chain, wallet),
        tradingSnapshot(wallet.address, chain).catch(() => null),
      ]);
      setWallet(session);
      setTrading(snap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send profit to the wallet");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const saveConfig = async (config: Partial<BotConfig>) => {
    if (!wallet) return;
    setBusy(true);
    try {
      applyDesk(await configureBot(config, chain));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Config failed");
    } finally {
      setBusy(false);
    }
  };

  const closePos = async (positionId: string) => {
    if (!wallet) {
      setCloseError({ id: positionId, message: "Connect the wallet on this page to close this ticket." });
      return;
    }
    setClosingId(positionId);
    setCloseError(null);
    busyRef.current = true;
    try {
      applyDesk(await closeTicket(positionId, wallet, chain));
      setDetailId((cur) => (cur === positionId ? null : cur));
    } catch (e) {
      setCloseError({ id: positionId, message: e instanceof Error ? e.message : "Close failed" });
    } finally {
      busyRef.current = false;
      setClosingId(null);
    }
  };

  const cancelBid = async () => {
    if (!wallet) {
      setError("Connect the wallet on this page to cancel the bid.");
      return;
    }
    setCancelling(true);
    busyRef.current = true;
    try {
      applyDesk(await cancelResting(wallet, chain));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the limit bid");
    } finally {
      busyRef.current = false;
      setCancelling(false);
    }
  };

  const winRate = useMemo(() => {
    if (!desk) return 0;
    if (desk.config.walletSwaps) {
      const closes = desk.trades.filter((trade) => trade.signature && trade.action === "close" && trade.pnlUsd !== null);
      if (!closes.length) return 0;
      return (closes.filter((trade) => (trade.pnlUsd ?? 0) > 0).length / closes.length) * 100;
    }
    const t = desk.portfolio.winCount + desk.portfolio.lossCount;
    return t ? (desk.portfolio.winCount / t) * 100 : 0;
  }, [desk]);

  const detail = desk?.positions.find((position) => position.id === detailId) ?? null;
  const nativeRow = desk?.research.find((r) => r.ticker === copy.native);
  const solPx = (chain === "solana" ? desk?.regime.sol.price : 0) || nativeRow?.price || wallet?.solPriceUsd || 0;
  const solChg = chain === "solana" && desk?.regime.sol.price ? desk.regime.sol.change24h : nativeRow?.candidate.flows.h24.priceChangePct;
  const solArmed = chain === "solana" ? Boolean(desk?.bot.running) : peerArmed;
  const croArmed = chain === "cronos" ? Boolean(desk?.bot.running) : peerArmed;
  const switchChain = (next: ChainId) => {
    setWatchAddress(null);
    onSwitch(next);
  };

  if (watchAddress) {
    return (
      <div>
        <WatchScreen
          address={watchAddress}
          chain={chain}
          onClose={closeWatch}
          toolbar={<ChainSwitch chain={chain} solArmed={solArmed} croArmed={croArmed} onSwitch={switchChain} />}
        />
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="min-h-dvh overflow-y-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10">
        <div className="mx-auto w-full max-w-xl">
        <div className="neon boot-fade w-full max-w-xl p-5 sm:p-10">
          <div className="orb mb-6 grid place-items-center text-lg font-semibold text-[var(--accent-ink)]">T8</div>
          <div className="mb-5 flex justify-end">
            <ChainSwitch chain={chain} solArmed={solArmed} croArmed={croArmed} onSwitch={switchChain} />
          </div>
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--magenta)]">T-800 // {copy.kicker}</div>
          <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-5xl">Connect a wallet to arm the desk</h1>
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{copy.connectBlurb}</p>
          {walletError ? <p className="mt-4 text-sm text-[var(--crimson)]">{walletError}</p> : null}
          {chain === "solana" && phone && !walletHint ? (
            <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
              This opens Phantom. Unlock it and approve the connection. This browser then opens the desk.
            </p>
          ) : null}
          {chain === "solana" && phone && (resume > 0 || walletHint === "Phantom") ? (
            <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
              Phantom is open. Tap Approve. After you unlock, this desk connects.
            </p>
          ) : null}
          <button disabled={walletBusy} onClick={() => void connect(false)} className="btn btn-magenta mt-6 w-full">
            {walletBusy
              ? "Waiting on wallet…"
              : chain === "solana" && phone && (resume > 0 || walletHint === "Phantom")
                ? "Approve in Phantom"
                : chain === "solana" && phone && !walletHint
                  ? "Connect Phantom"
                  : walletHint
                    ? `Connect ${walletHint}`
                    : copy.connectFallback}
          </button>
          <div className="mt-5 grid gap-2 text-sm text-[var(--muted)] sm:grid-cols-3">
            <GateChip label="Live marks" hint="CoinGecko · GeckoTerminal" />
            <GateChip label="Wallet book" hint={`${copy.walletBook} only`} />
            <GateChip label="Live swaps" hint={copy.swapHint} />
          </div>
          <form
            className="mt-6 border-t border-[var(--line)] pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              openWatch(watchDraft);
            }}
          >
            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--faint)]">Watch a book</div>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {copy.watchBlurb}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={watchDraft}
                onChange={(event) => setWatchDraft(event.target.value)}
                placeholder="Wallet address"
                spellCheck={false}
                className="num w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-3 text-sm outline-none"
              />
              <button type="submit" className="btn btn-ink shrink-0">
                Watch
              </button>
            </div>
            {watchError ? <p className="mt-2 text-sm text-[var(--crimson)]">{watchError}</p> : null}
            {knownBooks.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {knownBooks.map((addr) => (
                  <button key={addr} type="button" onClick={() => openWatch(addr)} className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px] text-[var(--muted)]">
                    {shortAddress(addr)}
                  </button>
                ))}
              </div>
            ) : null}
          </form>
          <p className="mt-3 text-[11px] leading-5 text-[var(--faint)]">
            {walletHint ? `${walletHint} is injected in this browser.` : copy.installHint} {copy.armBlurb}
          </p>
        </div>
        </div>
      </div>
    );
  }

  if (!desk && !booting) {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="neon boot-fade max-w-md p-6">
          <div className="text-[var(--crimson)]">Desk offline</div>
          <p className="mt-2 text-sm text-[var(--muted)]">{error || "Live market payload failed."}</p>
          <button className="btn btn-ink mt-4" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
        <Header
        desk={desk}
        wallet={wallet}
        clock={clock}
        solPx={solPx}
        solChg={solChg}
        nativeLabel={copy.native}
        chain={chain}
        solArmed={solArmed}
        croArmed={croArmed}
        onSwitch={switchChain}
        updatedAt={updatedAt}
        onDisconnect={() => void disconnect()}
        onRefresh={() => void refresh()}
        onWatch={() => openWatch(wallet.address)}
        trading={trading}
      />

      <div className="mx-auto grid w-full min-w-0 max-w-[1500px] grid-cols-1 gap-4 px-3 py-4 sm:gap-5 sm:px-4 sm:py-5 lg:grid-cols-[228px_1fr]">
        <aside className="neon h-fit min-w-0 p-2 sm:p-3 lg:sticky lg:top-20">
          <div className="flex flex-wrap gap-1 lg:block">
          {NAV.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              data-active={tab === item.id}
              onClick={() => {
                setTab(item.id);
                setThesis(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="nav-item mb-1 flex w-auto items-center justify-between whitespace-nowrap px-3 py-2.5 text-left hover:bg-[var(--nav-hover)] lg:w-full lg:py-3"
            >
              <span>
                <span className="mr-2 hidden text-[11px] text-[var(--faint)] lg:inline">{item.kicker}</span>
                {item.label}
              </span>
              {item.id === "bot" && desk?.bot.running ? <span className="ml-2 h-1.5 w-1.5 rounded-full bg-[var(--mint)]" /> : null}
            </button>
          ))}
          </div>
          <button
            disabled={busy || !desk}
            onClick={() => void control(desk?.bot.running ? "stop" : "start")}
            className={`btn mt-3 w-full ${
              desk?.bot.running ? "bg-[var(--danger-soft)] text-[var(--crimson)]" : "btn-magenta"
            }`}
          >
            {desk?.bot.running ? "Disarm bot" : "Arm bot"}
          </button>
          {desk?.config.walletSwaps ? (
            <button
              disabled={busy || !trading || tradingProfitUsd(trading.equityUsd, desk?.bot.swapPrincipalUsd) < 1}
              onClick={() => void withdrawProfit()}
              className="btn btn-ink mt-2 w-full"
            >
              {trading && tradingProfitUsd(trading.equityUsd, desk?.bot.swapPrincipalUsd) >= 1
                ? `Send ${usd(tradingProfitUsd(trading.equityUsd, desk?.bot.swapPrincipalUsd))} profit`
                : "Send profits"}
            </button>
          ) : null}
          {desk?.bot.lastNote ? <p className="mt-3 line-clamp-3 px-2 text-[11px] leading-5 text-[var(--magenta)] lg:line-clamp-none">{desk.bot.lastNote}</p> : null}
          <p className="mt-2 break-words px-2 text-[11px] leading-5 text-[var(--faint)]">
            {trading
              ? `${trading.sol.toFixed(3)} ${copy.native} · ${trading.usdc.toFixed(2)} USDC on the trading key ${shortAddress(trading.address)}. Arm signed once. That key sends the swaps.`
              : `${wallet.sol.toFixed(3)} ${copy.native} · ${wallet.usdc.toFixed(2)} USDC. ${
                  desk?.config.walletSwaps ? "Arm signs once. That signature sends the swaps." : "Fills stay in this browser."
                }`}
          </p>
          <button onClick={() => void disconnect()} className="mt-2 min-h-11 px-2 text-[11px] uppercase tracking-[0.16em] text-[var(--faint)] sm:hidden">
            Disconnect
          </button>
        </aside>

        <main className="min-w-0 space-y-5 pt-1">
          {error ? (
            <div className="rounded-[18px] border border-[var(--danger-line)] bg-[var(--danger-fill)] px-4 py-3 text-sm text-[var(--crimson)]">
              {error}
            </div>
          ) : null}

          {!desk ? (
            <BootSkeleton address={wallet.address} />
          ) : (
            <div key={tab} className="tab-in">
              {tab === "overview" ? (
                <Overview
                  desk={desk}
                  wallet={wallet}
                  trading={trading}
                  winRate={winRate}
                  focusMint={focusMint}
                  chain={chain}
                  onFocus={setFocusMint}
                  onOpen={setThesis}
                  onArm={() => void control(armButton(desk.bot.running).action)}
                  busy={busy}
                />
              ) : null}
              {tab === "radar" ? <Radar desk={desk} chain={chain} onOpen={setThesis} /> : null}
              {tab === "bot" ? (
                <BotView
                  chain={chain}
                  desk={desk}
                  busy={busy}
                  closingId={closingId}
                  closeError={closeError}
                  cancelling={cancelling}
                  onControl={control}
                  onOpen={setThesis}
                  onOpenPosition={setDetailId}
                  onClose={(id) => void closePos(id)}
                  onCancelResting={() => void cancelBid()}
                />
              ) : null}
              {tab === "book" ? (
                <Book
                  chain={chain}
                  desk={desk}
                  wallet={wallet}
                  trading={trading}
                  winRate={winRate}
                  busy={busy}
                  closingId={closingId}
                  closeError={closeError}
                  onOpenPosition={setDetailId}
                  onClose={closePos}
                  onFlatten={() => void control("flatten")}
                  onWalletSwaps={(on) => void saveConfig({ walletSwaps: on })}
                  onWithdraw={() => void withdrawProfit()}
                />
              ) : null}
              {tab === "risk" ? <SettingsPanel chain={chain} desk={desk} busy={busy} onSave={saveConfig} onReset={() => void control("reset")} /> : null}
            </div>
          )}
          {desk ? (
            <div className="cmd hidden sm:block">
              1–5 tabs · Space arm · R refresh · F flatten · Esc thesis
            </div>
          ) : null}
        </main>
      </div>

      {thesis ? <ThesisDrawer thesis={thesis} onClose={() => setThesis(null)} /> : null}
      {detail ? (
        <PositionDrawer
          position={detail}
          closing={closingId === detail.id}
          error={closeError?.id === detail.id ? closeError.message : null}
          onDismiss={() => setDetailId(null)}
          onExit={() => void closePos(detail.id)}
        />
      ) : null}
      {toasts.length ? (
        <div className="toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className="toast text-sm">
              {t.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GateChip({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--chip)] px-3 py-3">
      <div className="text-xs font-medium text-[var(--text)]">{label}</div>
      <div className="mt-1 text-[11px] text-[var(--faint)]">{hint}</div>
    </div>
  );
}

function ChainSwitch({
  chain,
  solArmed,
  croArmed,
  onSwitch,
}: {
  chain: ChainId;
  solArmed: boolean;
  croArmed: boolean;
  onSwitch: (next: ChainId) => void;
}) {
  const item = (id: ChainId, label: string, armed: boolean) => (
    <button
      type="button"
      onClick={() => onSwitch(id)}
      className={`flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.12em] sm:min-h-0 sm:py-1 sm:tracking-[0.16em] ${
        chain === id ? "bg-[var(--accent-soft)] text-[var(--magenta)]" : "text-[var(--faint)]"
      }`}
    >
      {armed ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--mint)]" /> : null}
      {label}
    </button>
  );
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--line)] p-1">
      {item("solana", "SOL", solArmed)}
      {item("cronos", "CRO", croArmed)}
    </div>
  );
}

function Header({
  desk,
  wallet,
  clock,
  solPx,
  solChg,
  nativeLabel,
  chain,
  solArmed,
  croArmed,
  onSwitch,
  updatedAt,
  onDisconnect,
  onRefresh,
  onWatch,
  trading,
}: {
  desk: DeskPayload | null;
  wallet: DeskSession;
  clock: string;
  solPx: number;
  solChg?: number;
  nativeLabel: string;
  chain: ChainId;
  solArmed: boolean;
  croArmed: boolean;
  onSwitch: (next: ChainId) => void;
  updatedAt: string | null;
  onDisconnect: () => void;
  onRefresh: () => void;
  onWatch: () => void;
  trading: { equityUsd: number } | null;
}) {
  const armed = Boolean(desk?.bot.running);
  const equity = usd(trading ? trading.equityUsd : wallet.equityUsd);
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--header)] pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex w-full min-w-0 max-w-[1500px] flex-col gap-2 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--accent-chip)] text-sm font-semibold text-[var(--magenta)]">
              T8
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">T-800 Trader</div>
              <div className="hidden text-[11px] uppercase tracking-[0.2em] text-[var(--faint)] sm:block">Live stream</div>
            </div>
          </div>
          <ChainSwitch chain={chain} solArmed={solArmed} croArmed={croArmed} onSwitch={onSwitch} />
          <div className="hidden items-center gap-5 md:flex">
            <Ticker label={nativeLabel} value={solPx ? priceFmt(solPx) : "—"} chg={solPx ? solChg : undefined} />
            <Ticker
              label="BTC"
              value={desk?.regime.btc.price ? priceFmt(desk.regime.btc.price) : "—"}
              chg={desk?.regime.btc.price ? desk.regime.btc.change24h : undefined}
            />
            <Ticker
              label="ETH"
              value={desk?.regime.eth.price ? priceFmt(desk.regime.eth.price) : "—"}
              chg={desk?.regime.eth.price ? desk.regime.eth.change24h : undefined}
            />
            {desk?.regime.fearGreed ? <Ticker label="F&G" value={`${desk.regime.fearGreed.value}`} hint={desk.regime.fearGreed.label} /> : null}
          </div>
          <div className="ml-auto hidden flex-wrap items-center justify-end gap-3 text-sm sm:flex">
            <button onClick={onRefresh} className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
              Refresh
            </button>
            <button onClick={onWatch} className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
              Watch
            </button>
            <Pill tone="magenta">{shortAddress(wallet.address)}</Pill>
            <Pill tone={armed ? "mint" : "default"}>
              <span className={`pulse-dot ${armed ? "bg-[var(--mint)] text-[var(--mint)]" : "bg-[var(--faint)] text-[var(--faint)]"}`} />
              {armed ? "Armed" : "Standby"}
            </Pill>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">{trading ? "Trading" : "Wallet"}</div>
              <div className="num">{equity}</div>
            </div>
            <button onClick={onDisconnect} className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
              Disconnect
            </button>
            {desk ? (
              <div className="hidden text-right md:block">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">Day P&L</div>
                <Tone value={desk.portfolio.dayPnlUsd}>{usd(desk.portfolio.dayPnlUsd)}</Tone>
              </div>
            ) : null}
            <div className="num hidden text-[var(--muted)] lg:block">{updatedAt ? new Date(updatedAt).toLocaleTimeString() : clock}</div>
          </div>
          <span className="ml-auto sm:hidden">
            <Pill tone={armed ? "mint" : "default"}>
              <span className={`pulse-dot ${armed ? "bg-[var(--mint)] text-[var(--mint)]" : "bg-[var(--faint)] text-[var(--faint)]"}`} />
              {armed ? "Armed" : "Standby"}
            </Pill>
          </span>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:hidden">
          <Ticker label={nativeLabel} value={solPx ? priceFmt(solPx) : "—"} chg={solPx ? solChg : undefined} />
          <Pill tone="magenta">{shortAddress(wallet.address)}</Pill>
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--faint)]">{trading ? "Trading" : "Wallet"}</div>
            <div className="num text-xs">{equity}</div>
          </div>
          <button onClick={onRefresh} className="min-h-11 shrink-0 text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
            Refresh
          </button>
          <button onClick={onWatch} className="min-h-11 shrink-0 text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
            Watch
          </button>
          <button onClick={onDisconnect} className="min-h-11 shrink-0 text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
            Disconnect
          </button>
        </div>
      </div>
    </header>
  );
}

function BootSkeleton({ address }: { address: string }) {
  return (
    <div className="space-y-4 boot-fade">
      <div className="text-sm text-[var(--muted)]">
        Pulling live tape for <span className="num text-[var(--text)]">{shortAddress(address)}</span> — no demo payload.
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="neon h-44 p-5">
          <div className="skel h-3 w-16" />
          <div className="skel mt-6 h-10 w-32" />
        </div>
        <div className="neon h-44 p-5">
          <div className="skel h-3 w-24" />
          <div className="skel mt-6 h-10 w-20" />
        </div>
      </div>
      <div className="neon h-56 p-3">
        <div className="skel h-full w-full" />
      </div>
    </div>
  );
}

function shownFills<T extends { signature?: string }>(rows: T[], walletSwaps: boolean): T[] {
  return walletSwaps ? rows.filter((row) => Boolean(row.signature)) : rows;
}

function sideText(side: string, leverage?: number): string {
  return leverage && leverage > 1 ? `${side} ${leverage}x` : side;
}

function rowPnl(position: Position): number {
  const pnlPct = ((position.markPrice - position.entryPrice) / position.entryPrice) * 100 * (position.side === "long" ? 1 : -1);
  return position.qty * position.entryPrice * (pnlPct / 100);
}

function PositionRail({ positions }: { positions: Position[] }) {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {positions.map((p) => {
        const pnlPct = ((p.markPrice - p.entryPrice) / p.entryPrice) * 100 * (p.side === "long" ? 1 : -1);
        return (
          <div key={p.id} className="neon p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium">
                {p.symbol} <span className="text-[11px] text-[var(--faint)]">{sideText(p.side, p.leverage)}</span>
              </div>
              <Tone value={pnlPct} />
            </div>
            <div className="mt-2 text-xs text-[var(--muted)]">
              {priceFmt(p.entryPrice)} → {priceFmt(p.markPrice)} · {p.reason} · {rMultiple(p).toFixed(2)}R
              {p.scaled ? " · scaled" : ""}
            </div>
            <div className="mt-3">
              <RangeBar position={p} />
            </div>
          </div>
        );
      })}
    </section>
  );
}

function RangeBar({ position }: { position: Position }) {
  const pts = [position.stopPrice, position.entryPrice, position.markPrice, position.targetPrice];
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const x = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;
  return (
    <div className="range-track">
      <span className="range-mark bg-[var(--crimson)]" style={{ left: x(position.stopPrice) }} />
      <span className="range-mark bg-white" style={{ left: x(position.entryPrice) }} />
      <span className="range-mark bg-[var(--magenta)]" style={{ left: x(position.markPrice) }} />
      <span className="range-mark bg-[var(--mint)]" style={{ left: x(position.targetPrice) }} />
    </div>
  );
}

function Ticker({ label, value, chg, hint }: { label: string; value: string; chg?: number; hint?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="num text-sm">{value}</span>
        {chg !== undefined ? <Tone value={chg} /> : <span className="text-xs text-[var(--muted)]">{hint}</span>}
      </div>
    </div>
  );
}

function useWatchTapes(tapes: TapeCard[], chain: ChainId): Record<string, Candle[]> {
  const key = tapes.map((tape) => tape.poolAddress).join("|");
  const [bars, setBars] = useState<Record<string, Candle[]>>({});
  useEffect(() => {
    if (!key) return;
    const pools = key.split("|");
    let live = true;
    const pull = async () => {
      const rows = await Promise.all(
        pools.map(async (poolAddress) => {
          try {
            const candles = await fetchOhlcv(poolAddress, 48, chain);
            return [poolAddress, candles] as const;
          } catch {
            return [poolAddress, null] as const;
          }
        }),
      );
      if (!live) return;
      setBars((cur) => {
        const next = { ...cur };
        let changed = false;
        for (const [poolAddress, candles] of rows) {
          if (!candles?.length || next[poolAddress] === candles) continue;
          next[poolAddress] = candles;
          changed = true;
        }
        return changed ? next : cur;
      });
    };
    void pull();
    const id = setInterval(() => void pull(), 15_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [chain, key]);
  return bars;
}

function Overview({
  desk,
  wallet,
  trading,
  winRate,
  focusMint,
  chain,
  onFocus,
  onOpen,
  onArm,
  busy,
}: {
  desk: DeskPayload;
  wallet: DeskSession;
  trading: { equityUsd: number } | null;
  winRate: number;
  focusMint: string | null;
  chain: ChainId;
  onFocus: (mint: string) => void;
  onOpen: (t: ResearchThesis) => void;
  onArm: () => void;
  busy: boolean;
}) {
  const copy = CHAIN_COPY[chain];
  const focus = desk.research.find((r) => r.candidate.mint === focusMint) ?? desk.research[0] ?? null;
  const bars = useWatchTapes(desk.tapes, chain);
  const focusTape = desk.tapes.find((tape) => tape.mint === focus?.candidate.mint) ?? desk.tapes[0] ?? null;
  const focusCandles = focusTape ? bars[focusTape.poolAddress] ?? [] : [];
  const stanceTone = desk.regime.stance === "risk-on" ? "mint" : desk.regime.stance === "defensive" ? "crimson" : "amber";
  const swaps = desk.config.walletSwaps;
  const fills = shownFills(desk.trades, swaps);
  const open = shownFills(desk.positions, swaps);
  const curve = desk.equityCurve.map((p) => p.equity);
  const marked = trading?.equityUsd || wallet.equityUsd;
  const equitySeries = swaps ? (marked ? [marked] : []) : curve.length >= 1 ? curve : marked ? [marked] : [];
  const stats = swaps
    ? bookStats(fills, { ...desk.portfolio, peakEquity: marked || desk.portfolio.equityUsd, equityUsd: marked || desk.portfolio.equityUsd }, [])
    : desk.stats;
  const realized = fills.filter((trade) => trade.action === "close").reduce((sum, trade) => sum + (trade.pnlUsd ?? 0), 0);
  const unrealized = swaps ? open.reduce((sum, position) => sum + rowPnl(position), 0) : desk.portfolio.unrealizedPnlUsd;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section className="neon p-5">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]">
            <span>{focus ? focus.ticker : "NO FINALIST"}</span>
            <Pill tone="magenta">Live</Pill>
          </div>
          <div className="mt-4 num text-4xl">{focus ? priceFmt(focus.price) : "—"}</div>
          <div className="mt-2 text-sm">
            {focus ? <Tone value={focus.candidate.flows.h24.priceChangePct} /> : <span className="text-[var(--faint)]">Waiting on live pools</span>}
          </div>
          {desk.research.length > 1 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {desk.research.slice(0, 6).map((r) => (
                <button
                  key={r.id}
                  onClick={() => onFocus(r.candidate.mint)}
                  className={`rounded-full px-2.5 py-1 text-[11px] ${
                    focus?.id === r.id ? "bg-[var(--accent-soft)] text-[var(--magenta)]" : "text-[var(--faint)] hover:text-[var(--text)]"
                  }`}
                >
                  {r.ticker}
                </button>
              ))}
            </div>
          ) : null}
          <button
            disabled={busy}
            onClick={onArm}
            className={`btn mt-5 w-full ${desk.bot.running ? "bg-[var(--danger-soft)] text-[var(--crimson)]" : "btn-magenta"}`}
          >
            {armButton(desk.bot.running).label}
          </button>
          {desk.bot.lastNote ? <p className="mt-3 text-[11px] leading-5 text-[var(--magenta)]">{desk.bot.lastNote}</p> : null}
        </section>
        <section className="neon p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]"># trades · live stream</div>
          <div className="mt-3 flex items-end justify-between">
            <div className="num text-4xl">{swaps ? fills.length : desk.portfolio.tradeCount}</div>
            <Spark values={equitySeries} />
          </div>
          <div className="mt-3 text-xs text-[var(--muted)]">
            {swaps ? `${stats.closedTrades} signed closes` : `${desk.portfolio.winCount}W / ${desk.portfolio.lossCount}L`} · hit {winRate.toFixed(0)}%
          </div>
        </section>
      </div>

      <section className="neon p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <Label>5-minute tapes</Label>
          <span className="text-[11px] text-[var(--faint)]">
            {desk.bot.lastTickAt ? `Tick ${desk.bot.ticks} · ${new Date(desk.bot.lastTickAt).toLocaleTimeString()}` : "Waiting for tick 1"}
          </span>
        </div>
        <p className="mb-3 px-1 text-sm leading-6 text-[var(--text)]">
          {desk.bot.lastNote ?? copy.waitingTick}
        </p>
        <div className={`grid gap-3 ${bookTokens(chain).length > 1 ? "md:grid-cols-2" : ""}`}>
          {bookTokens(chain).map((token) => {
            const symbol = token.symbol;
            const tape = desk.tapes.find((row) => row.symbol === symbol);
            const call = assetCall(symbol, desk.signals, desk.bot.blocked ?? []);
            const live = desk.signals.some((row) => row.symbol === symbol);
            return (
              <button
                key={symbol}
                onClick={() => tape && onFocus(tape.mint)}
                className={`rounded-2xl border p-2 text-left ${
                  tape && focusTape?.poolAddress === tape.poolAddress ? "border-[var(--magenta)]" : "border-[var(--line)]"
                }`}
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-sm font-medium">{tapeLabel(symbol)}</span>
                  {tape ? <Tone value={tape.change15m} /> : <span className="text-[11px] text-[var(--faint)]">—</span>}
                </div>
                <p className={`mb-1 px-1 text-sm ${live ? "text-[var(--mint)]" : "text-[var(--muted)]"}`}>{call}</p>
                <div className="h-[132px]">
                  {tape ? <CandleChart candles={bars[tape.poolAddress] ?? []} /> : null}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {open.length ? <PositionRail positions={open} /> : null}

      <section className="grid gap-3 md:grid-cols-4">
        <Stat label={swaps ? "Realized" : "Day P&L"} value={<Tone value={swaps ? realized : desk.portfolio.dayPnlUsd}>{usd(swaps ? realized : desk.portfolio.dayPnlUsd)}</Tone>} sub={swaps ? `${stats.closedTrades} signed closes` : `DD ${desk.stats.maxDrawdownPct.toFixed(1)}%`} />
        <Stat label="Expectancy" value={usd(stats.expectancyUsd)} sub={`${stats.closedTrades} closed`} />
        <Stat
          label="Profit factor"
          value={stats.profitFactor === null ? "—" : Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞"}
          sub={`avg W ${usd(stats.avgWinUsd)}`}
        />
        <Stat label="Unrealized" value={<Tone value={unrealized}>{usd(unrealized)}</Tone>} sub={`${open.length} open`} />
      </section>

      <section className="neon p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2">
          <Label>Live tape</Label>
          <span className="min-w-0 text-[11px] text-[var(--faint)]">
            Universe {desk.universeSize || "—"} · screened {desk.eliminated || "—"} · scored {desk.candidatesScanned || "—"}
          </span>
        </div>
        <div className="h-[220px]">
          <ScatterTape dots={desk.tapeDots} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="neon p-3">
          <Label>Wallet equity curve</Label>
          <div className="h-[110px]">
            <EquityPath values={equitySeries} />
          </div>
        </div>
        <div className="neon p-3">
          <Label>Pool volume</Label>
          <div className="h-[110px]">
            <VolumeBars candles={focusCandles} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="neon p-5">
          <div className="flex items-center justify-between">
            <Pill tone={stanceTone}>{desk.regime.stance.replace("-", " ")}</Pill>
            <span className="text-xs text-[var(--faint)]">{shortAddress(wallet.address)}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{desk.regime.overview}</p>
          {(desk.regime.yields ?? []).length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {(desk.regime.yields ?? []).map((y) => (
                <Pill key={y.label} tone="mint">
                  {y.label} {y.apyPct.toFixed(2)}% APY
                </Pill>
              ))}
            </div>
          ) : null}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <Label>Crowded</Label>
              <ul className="space-y-2 text-sm text-[var(--muted)]">
                {desk.regime.crowded.map((c) => (
                  <li key={c}>— {c}</li>
                ))}
              </ul>
            </div>
            <div>
              <Label>Overlooked</Label>
              <ul className="space-y-2 text-sm text-[var(--muted)]">
                {desk.regime.overlooked.map((c) => (
                  <li key={c}>— {c}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="neon p-5">
          <Label>Execution log</Label>
          {fills.length === 0 ? (
            <div className="space-y-2 text-sm text-[var(--muted)]">
              <p>
                {swaps
                  ? copy.noSwaps
                  : "No tickets yet. Arm the bot to paper-trade this browser. Wallet swaps are off, so nothing is broadcast."}
              </p>
              {desk.bot.lastNote ? <p className="text-[11px] leading-5 text-[var(--magenta)]">{desk.bot.lastNote}</p> : null}
              {desk.signals.slice(0, 4).map((s) => (
                <p key={s.id} className="font-mono text-[11px]">
                  SIG {s.symbol} {s.side} {s.reason} conf {s.confidence.toFixed(0)}
                </p>
              ))}
            </div>
          ) : (
            <div className="desk-scroll max-h-56 space-y-2 overflow-y-auto break-words font-mono text-[11px] text-[var(--muted)]">
              {fills.slice(0, 12).map((t) => (
                <div key={t.id}>
                  {new Date(t.at).toLocaleTimeString()} {t.action} {t.symbol} {t.side} {priceFmt(t.price)} {t.reason}
                  {t.signature ? ` ${t.signature.slice(0, 8)}` : ""}
                </div>
              ))}
              {desk.signals.slice(0, 8).map((s) => (
                <div key={s.id}>
                  SIG {s.symbol} {s.side} {s.reason} conf {s.confidence.toFixed(0)}
                </div>
              ))}
              {desk.bot.lastNote ? <div>{desk.bot.lastNote}</div> : null}
            </div>
          )}
          <div className="mt-4 space-y-2">
            {desk.research.slice(0, 4).map((r) => (
              <button
                key={r.id}
                onClick={() => onOpen(r)}
                className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-2 text-left hover:bg-[var(--accent-wash)]"
              >
                <span className="min-w-0">
                  {r.ticker} <span className="text-[var(--muted)]">{r.sector}</span>
                  {r.candidate.apyPct ? (
                    <span className="num text-[var(--faint)]"> {r.candidate.apyPct.toFixed(2)}% APY</span>
                  ) : null}
                </span>
                <span className="num shrink-0 text-[var(--magenta)]">{r.researchScore.toFixed(1)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Radar({ desk, chain, onOpen }: { desk: DeskPayload; chain: ChainId; onOpen: (t: ResearchThesis) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-medium tracking-tight">Research radar</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{CHAIN_COPY[chain].radar}</p>
      </div>
      <div className="space-y-3 md:hidden">
        {desk.research.length === 0 ? (
          <div className="neon p-4 text-sm text-[var(--muted)]">No live finalists this cycle.</div>
        ) : (
          desk.research.map((r) => (
            <button key={r.id} type="button" onClick={() => onOpen(r)} className="neon block w-full p-4 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{r.ticker}</div>
                  <div className="text-[11px] text-[var(--faint)]">{r.asset} · {venueLabel(venueForDex(r.candidate.dex))}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-sm">{priceFmt(r.price)}</div>
                  <div className="num text-[var(--magenta)]">{r.researchScore.toFixed(1)}</div>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{r.coreThesis}</p>
              <p className="mt-2 text-xs leading-5 text-[var(--text)]">{r.keyCatalyst}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--crimson)]">{r.biggestRisk}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--faint)]">
                <span>{r.sector}</span>
                <span>MC {usd(r.marketCap)}</span>
                <span>{r.keyMetric}</span>
              </div>
            </button>
          ))
        )}
      </div>
      <div className="neon desk-scroll hidden overflow-x-auto p-1 md:block">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3">Asset</th>
              <th>Ticker</th>
              <th>Price</th>
              <th>APY</th>
              <th>Market cap</th>
              <th>FDV</th>
              <th>Sector</th>
              <th>Core thesis</th>
              <th>Key catalyst</th>
              <th>Biggest risk</th>
              <th>Key metric</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {desk.research.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-[var(--muted)]" colSpan={12}>
                  No live finalists this cycle.
                </td>
              </tr>
            ) : (
              desk.research.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => onOpen(r)}
                  className="cursor-pointer border-t border-[var(--line)] hover:bg-[var(--accent-wash)]"
                >
                  <td className="px-4 py-3 font-medium">{r.asset}</td>
                  <td className="num">
                    {r.ticker}
                    <span className="block text-[10px] font-sans text-[var(--faint)]">
                      {venueLabel(venueForDex(r.candidate.dex))}
                    </span>
                  </td>
                  <td className="num">
                    {priceFmt(r.price)}
                    {r.candidate.priceAgreement === "split" ? (
                      <span className="block text-[10px] uppercase tracking-wide text-[var(--crimson)]">feeds split</span>
                    ) : r.candidate.priceAgreement === "agree" ? (
                      <span className="block text-[10px] text-[var(--faint)]">
                        {r.candidate.sources.filter((s) => s.endsWith(":price") || s.endsWith(":jlp-price")).length} feeds
                      </span>
                    ) : null}
                  </td>
                  <td className="num">{r.candidate.apyPct ? `${r.candidate.apyPct.toFixed(2)}%` : "—"}</td>
                  <td className="num">{usd(r.marketCap)}</td>
                  <td className="num">{usd(r.fdv)}</td>
                  <td>{r.sector}</td>
                  <td className="max-w-[260px] truncate text-[var(--muted)]">{r.coreThesis}</td>
                  <td className="max-w-[160px] truncate">{r.keyCatalyst}</td>
                  <td className="max-w-[160px] truncate text-[var(--crimson)]">{r.biggestRisk}</td>
                  <td className="num">{r.keyMetric}</td>
                  <td className="num text-[var(--magenta)]">{r.researchScore.toFixed(1)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BotView({
  chain,
  desk,
  busy,
  closingId,
  closeError,
  cancelling,
  onControl,
  onOpen,
  onOpenPosition,
  onClose,
  onCancelResting,
}: {
  chain: ChainId;
  desk: DeskPayload;
  busy: boolean;
  closingId: string | null;
  closeError: { id: string; message: string } | null;
  cancelling: boolean;
  onControl: (a: "start" | "stop" | "reset" | "tick" | "flatten") => void;
  onOpen: (t: ResearchThesis) => void;
  onOpenPosition: (id: string) => void;
  onClose: (id: string) => void;
  onCancelResting: () => void;
}) {
  const swaps = desk.config.walletSwaps;
  const open = shownFills(desk.positions, swaps);
  const closed = shownFills(desk.trades, swaps).filter((trade) => trade.action === "close");
  return (
    <div className="space-y-4">
      <section className="neon p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Pill tone={desk.bot.running ? "mint" : "magenta"}>{desk.bot.running ? CHAIN_COPY[chain].scanning : "Idle"}</Pill>
            <h2 className="mt-3 text-2xl font-medium sm:text-3xl">Wallet-gated ticks. Time-boxed.</h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              {desk.bot.lastNote ??
                "One new ticket per tick. Breakouts must clear the prior high. Winners scale at 1R; stops move to breakeven at 0.8R."}
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <button disabled={busy} onClick={() => onControl(desk.bot.running ? "stop" : "start")} className="btn btn-ink w-full sm:w-auto">
              {desk.bot.running ? "Disarm" : "Arm"}
            </button>
            <button disabled={busy} onClick={() => onControl("tick")} className="btn btn-ghost w-full sm:w-auto">
              Force tick
            </button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <Stat label="Ticks" value={desk.bot.ticks} sub={desk.bot.lastTickAt ? new Date(desk.bot.lastTickAt).toLocaleTimeString() : "—"} />
          <Stat
            label="Open / closed"
            value={`${open.length} / ${closed.length}`}
            sub={desk.bot.lastTickAt ? `Book now · tick ${new Date(desk.bot.lastTickAt).toLocaleTimeString()}` : "Book now"}
          />
          <Stat label="Last error" value={desk.bot.lastError ? "Yes" : "None"} sub={desk.bot.lastError ?? "Clean"} tone={desk.bot.lastError ? "crimson" : "mint"} />
          <Stat label="Daily loss cap" value={`${desk.config.dailyLossLimitPct}%`} />
        </div>
        <div className="mt-5 rounded-2xl border border-[var(--line)] p-4">
          <Label>What the book has learned</Label>
          <p className="text-sm leading-6 text-[var(--muted)]">{desk.learning.summary}</p>
          {desk.learning.edges.length ? (
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {desk.learning.edges.map((edge) => (
                <div key={edge.key} className="rounded-2xl border border-[var(--line)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm">{edge.label}</span>
                    <Pill tone={edge.bias === "favor" ? "mint" : edge.bias === "fade" ? "crimson" : "amber"}>{edge.bias}</Pill>
                  </div>
                  <p className="mt-1 text-xs text-[var(--faint)]">
                    {edge.samples} samples · {(edge.hitRate * 100).toFixed(0)}% · {edge.avgR >= 0 ? "+" : ""}
                    {edge.avgR.toFixed(2)}
                    {edge.unit}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          {desk.learning.recent.length ? (
            <ul className="mt-3 space-y-1 text-sm text-[var(--muted)]">
              {desk.learning.recent.map((lesson) => (
                <li key={lesson.id}>— {lesson.note}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {desk.bot.resting ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] px-3 py-2">
            <p className="text-sm text-[var(--muted)]">
              {desk.bot.resting.symbol} limit bid at {priceFmt(desk.bot.resting.limitPrice)} · waiting for a taker · {txLink(desk.bot.resting.signature)}
            </p>
            <button
              type="button"
              disabled={cancelling}
              onClick={onCancelResting}
              className="rounded-lg border border-[var(--danger-border)] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--crimson)] disabled:opacity-60"
            >
              {cancelling ? "Cancelling…" : "Cancel bid"}
            </button>
          </div>
        ) : null}
        {(desk.bot.blocked ?? []).length ? (
          <div className="mt-4 rounded-2xl border border-[var(--line)] p-3 text-sm text-[var(--muted)]">
            <Label>This tick</Label>
            <ul className="space-y-1">
              {(desk.bot.blocked ?? []).map((b) => (
                <li key={b}>— {b}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="neon p-5">
          <div className="flex items-center justify-between">
            <Label>Open positions</Label>
            <span className="text-[11px] text-[var(--faint)]">{open.length}</span>
          </div>
          {open.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              {swaps
                ? `No open swap. This list refreshes on every scan, and a signed ticket shows up here with its ${CHAIN_COPY[chain].explorerName} link.`
                : "No open ticket. This list refreshes on every scan."}
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {open.map((position) => {
                const pnl = rowPnl(position);
                return (
                  <div key={position.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => onOpenPosition(position.id)} className="text-left">
                        <div className="font-medium">
                          {position.symbol} <span className="text-[11px] text-[var(--faint)]">{sideText(position.side, position.leverage)}</span>
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {priceFmt(position.entryPrice)} → {priceFmt(position.markPrice)} · {position.reason}
                        </div>
                      </button>
                      <div className="text-[10px]">{txLink(position.signature)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <Tone value={pnl}>{usd(pnl)}</Tone>
                      <PositionActions
                        closing={closingId === position.id}
                        error={closeError?.id === position.id ? closeError.message : null}
                        onOpen={() => onOpenPosition(position.id)}
                        onClose={() => onClose(position.id)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="neon p-5">
          <div className="flex items-center justify-between">
            <Label>Closed tickets</Label>
            <span className="text-[11px] text-[var(--faint)]">{closed.length}</span>
          </div>
          {closed.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              {swaps ? "No signed close yet. A sell from the trading key lands in this list." : "No closed ticket yet."}
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {closed.slice(0, 12).map((trade) => (
                <div key={trade.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-2">
                  <div>
                    <div className="font-medium">
                      {trade.symbol} <span className="text-[11px] text-[var(--faint)]">{trade.reason}</span>
                    </div>
                    <div className="text-[11px] text-[var(--muted)]">
                      {new Date(trade.at).toLocaleTimeString()} · {priceFmt(trade.price)}
                    </div>
                    <div className="text-[10px]">{txLink(trade.signature)}</div>
                  </div>
                  <Tone value={trade.pnlUsd ?? 0}>{trade.pnlUsd === null ? "—" : usd(trade.pnlUsd)}</Tone>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="neon p-5">
          <Label>Signals this cycle</Label>
          <p className="text-[11px] leading-5 text-[var(--magenta)]">
            {desk.bot.lastNote ?? "The first scan starts as soon as the wallet is connected."}
          </p>
          {desk.signals.length === 0 ? (
            <div className="mt-3 text-sm text-[var(--muted)]">
              {(desk.bot.blocked ?? []).length ? (
                <ul className="space-y-1">
                  {(desk.bot.blocked ?? []).map((line) => (
                    <li key={line}>— {line}</li>
                  ))}
                </ul>
              ) : (
                <p>No long on this scan. A red 15-minute tape stays in cash.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {desk.signals.map((s) => (
                <div key={s.id} className="rounded-2xl border border-[var(--line)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      {s.symbol} <Pill tone={s.side === "long" ? "mint" : "crimson"}>{s.side}</Pill>
                    </div>
                    <span className="num text-[var(--magenta)]">{s.confidence.toFixed(0)}</span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">{s.thesis}</p>
                </div>
              ))}
              {(desk.bot.blocked ?? []).length ? (
                <ul className="space-y-1 text-sm text-[var(--muted)]">
                  {(desk.bot.blocked ?? []).map((line) => (
                    <li key={line}>— {line}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
        <div className="neon p-5">
          <Label>Research bench</Label>
          {desk.research.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No live finalists.</p>
          ) : (
            <div className="space-y-2">
              {desk.research.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onOpen(r)}
                  className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl px-2 py-2 text-left hover:bg-[var(--accent-wash)]"
                >
                  <span className="min-w-0">
                    {r.ticker} <span className="text-[var(--muted)]">{r.sector}</span>
                    {r.candidate.apyPct ? (
                      <span className="num text-[var(--faint)]"> {r.candidate.apyPct.toFixed(2)}% APY</span>
                    ) : null}
                    {r.candidate.priceAgreement === "split" ? (
                      <span className="text-[var(--crimson)]"> split</span>
                    ) : null}
                  </span>
                  <span className="num shrink-0 text-[var(--magenta)]">{r.researchScore.toFixed(1)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Book({
  chain,
  desk,
  wallet,
  trading,
  winRate,
  busy,
  closingId,
  closeError,
  onOpenPosition,
  onClose,
  onFlatten,
  onWalletSwaps,
  onWithdraw,
}: {
  chain: ChainId;
  desk: DeskPayload;
  wallet: DeskSession;
  trading: { address: string; sol: number; usdc: number; equityUsd: number } | null;
  winRate: number;
  busy: boolean;
  closingId: string | null;
  closeError: { id: string; message: string } | null;
  onOpenPosition: (id: string) => void;
  onClose: (id: string) => void;
  onFlatten: () => void;
  onWalletSwaps: (on: boolean) => void;
  onWithdraw: () => void;
}) {
  const copy = CHAIN_COPY[chain];
  const swaps = desk.config.walletSwaps;
  const fills = shownFills(desk.trades, swaps);
  const open = shownFills(desk.positions, swaps);
  const curve = desk.equityCurve.map((p) => p.equity);
  const marked = trading?.equityUsd || wallet.equityUsd;
  const equitySeries = swaps ? (marked ? [marked] : []) : curve.length >= 1 ? curve : marked ? [marked] : [];
  const stats = swaps
    ? bookStats(fills, { ...desk.portfolio, peakEquity: marked || desk.portfolio.equityUsd, equityUsd: marked || desk.portfolio.equityUsd }, [])
    : desk.stats;
  const profit = trading ? tradingProfitUsd(trading.equityUsd, desk.bot.swapPrincipalUsd) : 0;
  const signedCloses = fills.filter((trade) => trade.action === "close" && trade.pnlUsd !== null);
  const wins = swaps ? signedCloses.filter((trade) => (trade.pnlUsd ?? 0) > 0).length : desk.portfolio.winCount;
  const losses = swaps ? signedCloses.filter((trade) => (trade.pnlUsd ?? 0) <= 0).length : desk.portfolio.lossCount;
  return (
    <div className="space-y-4">
      <div className="neon p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <Label>{swaps ? "Wallet swaps" : "Simulated book"}</Label>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {swaps
                ? copy.bookArm
                : "Wallet swaps are off, so this book only simulates fills. Turn them on, then arm, and the wallet signature is what sends the swaps."}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto">
            {swaps ? (
              <button disabled={busy || profit < 1} onClick={onWithdraw} className="btn btn-magenta w-full sm:w-auto">
                {profit >= 1 ? `Send ${usd(profit)} profit to my wallet` : "Send profits to my wallet"}
              </button>
            ) : null}
            <button disabled={busy} onClick={() => onWalletSwaps(!swaps)} className="btn btn-ink w-full sm:w-auto">
              {swaps ? "Stop wallet swaps" : "Send swaps to my wallet"}
            </button>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label={swaps ? "Signed tickets" : "Sim book"} value={swaps ? String(fills.length) : usd(desk.portfolio.equityUsd)} sub={<Spark values={equitySeries} />} />
        <Stat
          label={trading ? "Trading balance" : "Wallet mark"}
          value={usd(trading ? trading.equityUsd : wallet.equityUsd)}
          sub={
            trading
              ? `${trading.sol.toFixed(3)} ${copy.native} · ${trading.usdc.toFixed(2)} USDC · profit ${usd(profit)} · ${shortAddress(trading.address)}`
              : `${wallet.sol.toFixed(3)} ${copy.native} · ${wallet.usdc.toFixed(2)} USDC`
          }
        />
        <Stat label="Hit rate" value={`${winRate.toFixed(0)}%`} sub={`${wins}W / ${losses}L`} />
        <Stat label="Expectancy" value={usd(stats.expectancyUsd)} sub={`PF ${stats.profitFactor === null ? "—" : Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞"}`} />
      </div>
      <div className="neon">
        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          <Label>Open positions</Label>
          <button disabled={busy || open.length === 0} onClick={onFlatten} className="btn btn-ghost shrink-0 py-1.5 text-xs">
            Flatten book
          </button>
        </div>
        <div className="space-y-2 px-3 pb-3 md:hidden">
          {open.length === 0 ? (
            <p className="px-1 py-3 text-sm text-[var(--muted)]">{swaps ? copy.noOpen : "No open ticket."}</p>
          ) : (
            open.map((p) => {
              const pnlPct = ((p.markPrice - p.entryPrice) / p.entryPrice) * 100 * (p.side === "long" ? 1 : -1);
              const pnlUsd = p.qty * p.entryPrice * (pnlPct / 100);
              return (
                <div key={p.id} className="rounded-2xl border border-[var(--line)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {p.symbol} <span className="text-[11px] text-[var(--faint)]">{sideText(p.side, p.leverage)}</span>
                      </div>
                      <div className="mt-1 break-words text-[11px] text-[var(--muted)]">
                        {priceFmt(p.entryPrice)} → {priceFmt(p.markPrice)}
                      </div>
                    </div>
                    <Tone value={pnlUsd}>{usd(pnlUsd)}</Tone>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--faint)]">
                    <span>Stop {priceFmt(p.stopPrice)}</span>
                    <span>Target {priceFmt(p.targetPrice)}</span>
                    <span>{usd(p.notional)}</span>
                    <span>{rMultiple(p).toFixed(2)}R</span>
                  </div>
                  <div className="mt-2">{txLink(p.signature, chain)}</div>
                  <PositionActions
                    closing={closingId === p.id}
                    error={closeError?.id === p.id ? closeError.message : null}
                    onOpen={() => onOpenPosition(p.id)}
                    onClose={() => onClose(p.id)}
                  />
                </div>
              );
            })
          )}
        </div>
        <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
            <tr>
              <th className="px-4 py-2">Symbol</th>
              <th>Side</th>
              <th>Entry</th>
              <th>Mark</th>
              <th>Stop</th>
              <th>Target</th>
              <th>Notional</th>
              <th>P&L</th>
              <th>Range</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {open.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-[var(--muted)]" colSpan={10}>
                  {swaps ? copy.noOpen : "No open ticket."}
                </td>
              </tr>
            ) : (
              open.map((p) => {
                const pnlPct = ((p.markPrice - p.entryPrice) / p.entryPrice) * 100 * (p.side === "long" ? 1 : -1);
                const pnlUsd = p.qty * p.entryPrice * (pnlPct / 100);
                const r = rMultiple(p);
                return (
                  <tr key={p.id} className="border-t border-[var(--line)]">
                    <td className="px-4 py-3 font-medium">
                      {p.symbol} <span className="text-[11px] text-[var(--faint)]">{p.sector ?? ""}</span>
                      <div className="text-[10px]">{txLink(p.signature)}</div>
                    </td>
                    <td>{sideText(p.side, p.leverage)}</td>
                    <td className="num">{priceFmt(p.entryPrice)}</td>
                    <td className="num">{priceFmt(p.markPrice)}</td>
                    <td className="num">{priceFmt(p.stopPrice)}</td>
                    <td className="num">{priceFmt(p.targetPrice)}</td>
                    <td className="num">{usd(p.notional)}</td>
                    <td>
                      <Tone value={pnlUsd}>{usd(pnlUsd)}</Tone>
                      <div className="text-[10px] text-[var(--faint)]">{r.toFixed(2)}R · {pct(pnlPct)}</div>
                    </td>
                    <td className="w-36 pr-3">
                      <RangeBar position={p} />
                    </td>
                    <td className="pr-3">
                      <PositionActions
                        closing={closingId === p.id}
                        error={closeError?.id === p.id ? closeError.message : null}
                        onOpen={() => onOpenPosition(p.id)}
                        onClose={() => onClose(p.id)}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>
      <div className="neon">
        <div className="px-4 pt-4">
          <Label>Tickets</Label>
        </div>
        <div className="space-y-2 px-3 pb-3 md:hidden">
          {fills.length === 0 ? (
            <p className="px-1 py-3 text-sm text-[var(--muted)]">{swaps ? copy.noTickets : "No tickets."}</p>
          ) : (
            fills.slice(0, 40).map((t) => (
              <div key={t.id} className="rounded-2xl border border-[var(--line)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {t.symbol} <span className="text-[11px] text-[var(--faint)]">{t.action} · {t.side}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--muted)]">{new Date(t.at).toLocaleTimeString()} · {priceFmt(t.price)}</div>
                  </div>
                  <div className="shrink-0">{t.pnlUsd === null ? "—" : <Tone value={t.pnlUsd}>{usd(t.pnlUsd)}</Tone>}</div>
                </div>
                <p className="mt-2 break-words text-xs leading-5 text-[var(--muted)]">{t.reason}</p>
                <div className="mt-2">{txLink(t.signature, chain)}</div>
              </div>
            ))
          )}
        </div>
        <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
            <tr>
              <th className="px-4 py-2">Time</th>
              <th>Sym</th>
              <th>Action</th>
              <th>Side</th>
              <th>Price</th>
              <th>P&L</th>
              <th>Why</th>
              <th>Wallet</th>
            </tr>
          </thead>
          <tbody>
            {fills.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-[var(--muted)]" colSpan={8}>
                  {swaps ? copy.noTickets : "No tickets."}
                </td>
              </tr>
            ) : (
              fills.slice(0, 40).map((t) => (
                <tr key={t.id} className="border-t border-[var(--line)]">
                  <td className="num px-4 py-3 text-[var(--muted)]">{new Date(t.at).toLocaleTimeString()}</td>
                  <td>{t.symbol}</td>
                  <td>{t.action}</td>
                  <td>{t.side}</td>
                  <td className="num">{priceFmt(t.price)}</td>
                  <td>{t.pnlUsd === null ? "—" : <Tone value={t.pnlUsd}>{usd(t.pnlUsd)}</Tone>}</td>
                  <td className="text-[var(--muted)]">{t.reason}</td>
                  <td>{txLink(t.signature, chain)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function txLink(signature: string | undefined, chain: ChainId = "solana") {
  if (!signature) return <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">Simulated</span>;
  if (signature === "held") {
    return <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">Held in the trading key</span>;
  }
  const short = signature.length > 10 ? `${signature.slice(0, 4)}…${signature.slice(-4)}` : signature;
  return (
    <a className="num text-[11px] text-[var(--mint)]" href={txUrl(chain, signature)} target="_blank" rel="noreferrer">
      {short}
    </a>
  );
}

function parseCronosAddress(input: string): string | null {
  const trimmed = input.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function PositionActions({
  closing,
  error,
  onOpen,
  onClose,
}: {
  closing: boolean;
  error: string | null;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-1 flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onOpen}
          className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text)]"
        >
          Open
        </button>
        <button
          type="button"
          disabled={closing}
          onClick={onClose}
          className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-fill)] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--crimson)] disabled:opacity-60"
        >
          {closing ? "Closing…" : "Close"}
        </button>
      </div>
      {error ? <p className="max-w-[200px] text-right text-[10px] leading-4 text-[var(--crimson)]">{error}</p> : null}
    </div>
  );
}

function PositionDrawer({
  position,
  closing,
  error,
  onDismiss,
  onExit,
}: {
  position: Position;
  closing: boolean;
  error: string | null;
  onDismiss: () => void;
  onExit: () => void;
}) {
  const pnl = rowPnl(position);
  const pnlPct = position.entryPrice ? ((position.markPrice - position.entryPrice) / position.entryPrice) * 100 * (position.side === "long" ? 1 : -1) : 0;
  return (
    <div className="drawer-scrim fixed inset-0 z-40 flex justify-end bg-black/55 backdrop-blur-sm" onClick={onDismiss}>
      <aside
        className="drawer-panel desk-scroll h-full w-full max-w-xl overflow-y-auto border-l border-[var(--line)] bg-[var(--bg-2)] p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Pill tone={position.side === "long" ? "mint" : "crimson"}>{sideText(position.side, position.leverage)}</Pill>
            <h3 className="mt-3 text-2xl font-medium sm:text-3xl">{position.symbol}</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {position.reason} · {position.sector ?? "Unknown"} · {rMultiple(position).toFixed(2)}R
            </p>
          </div>
          <button type="button" onClick={onDismiss} className="text-sm text-[var(--muted)]">
            Back
          </button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Stat label="Entry" value={priceFmt(position.entryPrice)} />
          <Stat label="Mark" value={priceFmt(position.markPrice)} />
          <Stat label="Stop" value={priceFmt(position.stopPrice)} />
          <Stat label="Target" value={priceFmt(position.targetPrice)} />
          <Stat label="Notional" value={usd(position.notional)} />
          <Stat label="P&L" value={<Tone value={pnl}>{usd(pnl)}</Tone>} sub={pct(pnlPct)} />
        </div>
        <div className="mt-4">
          <RangeBar position={position} />
        </div>
        <div className="mt-4 text-[11px] text-[var(--muted)]">{txLink(position.signature)}</div>
        {position.leverage && position.leverage > 1 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            {position.leverage}x · collateral {usd(position.collateralUsd ?? 0)}
            {position.positionPubkey ? ` · ${position.positionPubkey.slice(0, 4)}…${position.positionPubkey.slice(-4)}` : ""}
          </p>
        ) : null}
        {error ? <p className="mt-4 text-sm text-[var(--crimson)]">{error}</p> : null}
        <button
          type="button"
          disabled={closing}
          onClick={onExit}
          className="btn mt-6 w-full bg-[var(--danger-soft)] text-[var(--crimson)] disabled:opacity-60"
        >
          {closing ? "Closing…" : "Close position"}
        </button>
      </aside>
    </div>
  );
}

function ThesisDrawer({ thesis, onClose }: { thesis: ResearchThesis; onClose: () => void }) {
  return (
    <div className="drawer-scrim fixed inset-0 z-40 flex justify-end bg-black/55 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="drawer-panel desk-scroll h-full w-full max-w-xl overflow-y-auto border-l border-[var(--line)] bg-[var(--bg-2)] p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Pill tone="magenta">{thesis.sector}</Pill>
            <h3 className="mt-3 break-words text-2xl font-medium sm:text-3xl">
              {thesis.asset} <span className="text-[var(--muted)]">{thesis.ticker}</span>
            </h3>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
              <span>
                <Px n={thesis.price} />
              </span>
              <span>
                MC <Money n={thesis.marketCap} />
              </span>
              <span>
                FDV <Money n={thesis.fdv} />
              </span>
            </div>
          </div>
          <div className="text-right">
            <ScoreRing score={thesis.researchScore} />
            <button onClick={onClose} className="mt-3 text-sm text-[var(--muted)]">
              Close
            </button>
          </div>
        </div>
        <Block title="Core thesis" body={thesis.coreThesis} />
        <Block title="Why it may be mispriced" body={thesis.whyMispriced} />
        <List title="Fundamental evidence" items={thesis.fundamentalEvidence} />
        <List title="On-chain / tape evidence" items={thesis.onchainEvidence} />
        <Block title="Tokenomics" body={thesis.tokenomics} />
        <Block title="Relative valuation" body={thesis.relativeValuation} />
        <Block title="Competitive positioning" body={thesis.competitivePositioning} />
        <div className="mt-5">
          <Label>Catalysts</Label>
          <div className="space-y-2">
            {thesis.catalysts.map((c) => (
              <div key={c.title} className="rounded-2xl border border-[var(--line)] p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{c.title}</span>
                  <Pill tone={c.status === "confirmed" ? "mint" : "amber"}>{c.status}</Pill>
                  <span className="text-[var(--faint)]">{c.window}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">{c.detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 grid gap-3">
          <Block title="Bull" body={thesis.bullCase} />
          <Block title="Base" body={thesis.baseCase} />
          <Block title="Bear" body={thesis.bearCase} />
        </div>
        <List title="Thesis invalidation" items={thesis.invalidation} />
        <List title="Monitor" items={thesis.monitor} />
        <List title="Missing data (not invented)" items={thesis.missingData} />
        <List title="Sources" items={thesis.sources} />
        <div className="mt-6 text-xs text-[var(--faint)]">
          24h {pct(thesis.candidate.flows.h24.priceChangePct)} · Liq {usd(thesis.candidate.liquidityUsd)} · Vol{" "}
          {usd(thesis.candidate.volume24hUsd)}
          {thesis.candidate.apyPct
            ? ` · APY ${thesis.candidate.apyPct.toFixed(2)}% (${(thesis.candidate.apySources ?? []).join(", ")})`
            : ""}
          {thesis.candidate.priceAgreement === "agree"
            ? " · marks agree"
            : thesis.candidate.priceAgreement === "split"
              ? " · marks split — no new ticket"
              : ""}
        </div>
      </aside>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-5">
      <Label>{title}</Label>
      <p className="text-sm leading-6 text-[var(--muted)]">{body}</p>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-5">
      <Label>{title}</Label>
      <ul className="space-y-1.5 text-sm leading-6 text-[var(--muted)]">
        {items.map((i) => (
          <li key={i}>— {i}</li>
        ))}
      </ul>
    </div>
  );
}
