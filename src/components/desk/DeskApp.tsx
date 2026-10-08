"use client";

import { ALL_TA_LAYERS, AnalysisChart, CandleChart, EquityPath, ScatterTape, TaNotes, VolumeBars, type ChartLayers, type ChartTrade, type TaLayers } from "@/components/desk/charts";
import { ExecutionLog } from "@/components/desk/executions";
import { Home } from "@/components/desk/home";
import { SettingsPanel } from "@/components/desk/settings";
import { WatchScreen } from "@/components/desk/watch";
import { CHAIN_COPY, readDeskChain, sameMint, tapeLabel, txUrl, writeDeskChain, type ChainId } from "@/lib/chain";
import {
  adoptLiveEquity,
  armButton,
  attachWallet,
  baselineTradingPrincipal,
  cancelResting,
  closeTicket,
  configureBot,
  confirmLiveMode,
  controlBot,
  detachWallet,
  loadDesk,
  setPaperMode,
  shellDesk,
  tradingProfitUsd,
  tradingSnapshot,
  withdrawTradingProfit,
} from "@/lib/client";
import { isDeskShortcutTarget } from "@/lib/deskKeys";
import { detectDeskRunner, publishDeskBook, pullDeskBook } from "@/lib/deskHost";
import { startDeskKeepalive } from "@/lib/deskKeepalive";
import { getActiveWallet, listLocalBooks, loadState, readLastWallet, resumeSavedBook, saveState } from "@/lib/store";
import { nextTickWaitMs } from "@/lib/trading/runtime";
import { parseWalletAddress } from "@/lib/monitor";
import { cachedFrameChart, prefetchFrameCharts, rememberTapeMark, requestFrameCharts } from "@/lib/market/providers";
import { FRAME_LABEL, FRAMES, type Frame } from "@/lib/market/frames";
import { frameBias, type Bias } from "@/lib/market/analysis";
import { bookTokens } from "@/lib/market/universe";
import { assetCall } from "@/lib/market/tape";
import { venueForDex, venueLabel } from "@/lib/market/venues";
import { croHoldings, formatCro, formatCroEvm } from "@/lib/cronos/balance";
import { cronosWalletInstalled } from "@/lib/cronos/wallet";
import { connectDesk, detectedDeskWallet, disconnectDesk, listenDesk, refreshDesk, type DeskSession } from "@/lib/chains/session";
import { forgetPhantomApproval, injectedSolanaAddress, isOpenPhantomApp, resumeStage } from "@/lib/solana/wallet";
import type { BotConfig, Candle, DeskPayload, Position, ResearchThesis } from "@/lib/types";
import { pct, priceFmt, shortAddress, usd } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLiveSessionArmed } from "@/lib/solana/live-session";
import { MIN_TRADE_USD, rMultiple } from "@/lib/trading/risk";
import { bookStats } from "@/lib/trading/stats";
import { Label, Money, Pill, Px, ScoreRing, Spark, Stat, Tone } from "./bits";

type Tab = "home" | "overview" | "radar" | "bot" | "book" | "risk";

const NAV: { id: Tab; label: string; kicker: string }[] = [
  { id: "home", label: "Home", kicker: "01" },
  { id: "overview", label: "Charts", kicker: "02" },
  { id: "radar", label: "Coins", kicker: "03" },
  { id: "bot", label: "Bot log", kicker: "04" },
  { id: "book", label: "History", kicker: "05" },
  { id: "risk", label: "Settings", kicker: "06" },
];

function navFor() {
  return NAV;
}

function previewDeskSession(chain: ChainId, address: string, equityUsd: number): DeskSession {
  const base = { address, sol: 0, usdc: 0, solPriceUsd: null as number | null, equityUsd };
  if (chain === "cronos") {
    return { ...base, wcro: 0, posCro: 0, provider: { request: async () => [] } };
  }
  return {
    ...base,
    provider: {
      connect: async () => ({ publicKey: { toBase58: () => address } }),
    },
  };
}

export function DeskApp() {
  const [view, setView] = useState<ChainId>("solana");
  const [chainReady, setChainReady] = useState(false);
  const [running, setRunning] = useState<Record<ChainId, boolean>>({ solana: false, cronos: false });
  const markRunning = useCallback((chain: ChainId, next: boolean) => {
    setRunning((cur) => (cur[chain] === next ? cur : { ...cur, [chain]: next }));
  }, []);
  useEffect(() => {
    setView(readDeskChain());
    setChainReady(true);
  }, []);
  useEffect(() => {
    if (!chainReady) return;
    document.documentElement.dataset.desk = view;
    writeDeskChain(view);
  }, [chainReady, view]);
  if (!chainReady) return null;
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
  const [tab, setTab] = useState<Tab>("home");
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
  const [savedAddress, setSavedAddress] = useState<string | null>(null);
  const [liveConfirm, setLiveConfirm] = useState(false);
  const [armAfterLive, setArmAfterLive] = useState(false);
  const [pendingLiveConfig, setPendingLiveConfig] = useState<Partial<BotConfig> | null>(null);
  const [runnerHost, setRunnerHost] = useState(false);
  const lastTradeId = useRef<string | null>(null);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const busyRef = useRef(false);
  const controlGen = useRef(0);
  const runnerHostRef = useRef(false);
  runnerHostRef.current = runnerHost;

  const publishRunner = useCallback(async () => {
    if (!runnerHostRef.current) return;
    const address = walletRef.current?.address ?? getActiveWallet(chain);
    if (!address) return;
    try {
      await publishDeskBook(chain, address, await loadState(chain));
    } catch {
      // The next poll retries. Arming in this tab still saved the book locally.
    }
  }, [chain]);

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

  const applyDesk = useCallback((next: DeskPayload, opts?: { keepError?: boolean }) => {
    setDesk(next);
    if (!opts?.keepError) setError(null);
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
      setSavedAddress(session.address);
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
    setSavedAddress(null);
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
    // Hidden Cronos still mounted. Its unpaced Gecko charts 429 the shared
    // feed and leave Solana waiting on pool prints.
    if (!active && chain === "cronos") return;
    void prefetchFrameCharts(chain);
    const id = window.setInterval(() => {
      if (!active && chain === "cronos") return;
      void prefetchFrameCharts(chain);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [active, chain]);

  useEffect(() => {
    const last = readLastWallet(chain);
    setSavedAddress(last);
    if (!last) return;
    let cancelled = false;
    void resumeSavedBook(chain).then((book) => {
      if (cancelled || !book) return;
      applyDesk(shellDesk(book));
    });
    return () => {
      cancelled = true;
    };
  }, [applyDesk, chain]);

  useEffect(() => {
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
  }, [connect]);

  useEffect(() => {
    let cancelled = false;
    const id = window.setInterval(() => {
      if (cancelled || walletRef.current) return;
      const ready = chain === "cronos" ? cronosWalletInstalled() : Boolean(injectedSolanaAddress());
      if (!ready) return;
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
        setSavedAddress(null);
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
          setSavedAddress(session.address);
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

  const scanSecondsRef = useRef(5);
  const positionOpenRef = useRef(false);
  scanSecondsRef.current = Math.max(4, desk?.config.scanSeconds ?? 5);
  positionOpenRef.current = Boolean(desk?.bot.running && desk.positions.some((p) => p.signature || (p.leverage ?? 1) > 1));

  useEffect(() => {
    let cancel = false;
    const check = async () => {
      const status = await detectDeskRunner();
      if (!cancel) setRunnerHost(Boolean(status));
    };
    void check();
    const id = window.setInterval(() => {
      void check();
    }, 8_000);
    return () => {
      cancel = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!runnerHost) return;
    let cancel = false;
    const pull = async () => {
      const book = await pullDeskBook(chain);
      if (cancel || !book?.state) return;
      try {
        await attachWallet(book.wallet, Math.max(0, book.state.portfolio.equityUsd), chain);
        await saveState(book.state, chain);
        if (!busyRef.current) applyDesk(shellDesk(book.state), { keepError: true });
      } catch {
        // The runner keeps the book. The next poll retries.
      }
    };
    void pull();
    const id = window.setInterval(() => {
      void pull();
    }, 4_000);
    return () => {
      cancel = true;
      window.clearInterval(id);
    };
  }, [applyDesk, chain, runnerHost]);

  useEffect(() => {
    if (runnerHost) return;
    if (!active && !desk?.bot.running) return;
    if (!walletRef.current && !getActiveWallet(chain)) return;
    let cancel = false;
    let inflight = false;
    let timer = 0;
    const run = async () => {
      if (cancel || inflight || busyRef.current) return false;
      if (!walletRef.current && !getActiveWallet(chain)) return false;
      inflight = true;
      const gen = controlGen.current;
      try {
        // A saved book can tick before Phantom/Onchain returns. LIVE swaps
        // wait for the session; the scan still updates lastTickAt.
        const next = await controlBot("tick", walletRef.current, chain);
        // A start or stop click while this tick was in flight wins. Applying the
        // older book here would flip the button back.
        if (!cancel && !busyRef.current && gen === controlGen.current) applyDesk(next, { keepError: true });
        return true;
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : "Tick failed");
        return false;
      } finally {
        inflight = false;
      }
    };
    const arm = (delay: number) => {
      timer = window.setTimeout(() => {
        void (async () => {
          if (cancel) return;
          const started = Date.now();
          if (!busyRef.current) await run();
          if (cancel) return;
          arm(
            nextTickWaitMs({
              scanSeconds: scanSecondsRef.current,
              openLivePosition: positionOpenRef.current,
              usedMs: Date.now() - started,
            }),
          );
        })();
      }, delay);
    };
    arm(active ? 300 : 1_200);
    const stopKeep = startDeskKeepalive(() => {
      if (!cancel && !busyRef.current) void run();
    });
    return () => {
      cancel = true;
      window.clearTimeout(timer);
      stopKeep();
    };
  }, [active, applyDesk, chain, desk?.bot.running, runnerHost, wallet?.address]);

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
      if (isDeskShortcutTarget(e.target)) return;
      if (e.key >= "1" && e.key <= String(navFor().length)) {
        const next = navFor()[Number(e.key) - 1];
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

  const control = async (action: "start" | "stop" | "reset" | "tick" | "flatten" | "kill") => {
    if (!wallet) {
      setError(copy.needWallet);
      return;
    }
    if (action === "start" && chain === "solana" && desk?.config.walletSwaps && !isLiveSessionArmed()) {
      setArmAfterLive(true);
      setLiveConfirm(true);
      return;
    }
    busyRef.current = true;
    controlGen.current += 1;
    setBusy(true);
    setError(null);
    if (action === "stop" || action === "kill") {
      setDesk((cur) => (cur ? { ...cur, bot: { ...cur.bot, running: false, lastNote: "Stopping…" } } : cur));
    }
    if (action === "start") {
      setDesk((cur) =>
        cur
          ? {
              ...cur,
              liveSessionArmed: isLiveSessionArmed() || cur.liveSessionArmed,
              bot: {
                ...cur.bot,
                running: true,
                lastError: null,
                lastNote:
                  chain === "cronos"
                    ? "Approve the wallet signature to arm."
                    : cur.config.walletSwaps || isLiveSessionArmed()
                      ? "Armed — approve the wallet if it asks."
                      : "Armed — first tick incoming",
              },
            }
          : cur,
      );
    }
    try {
      if (action === "start" || action === "reset") {
        const session = await refreshDesk(chain, wallet);
        setWallet(session);
        if (action === "start" && desk?.config.walletSwaps && session.equityUsd < MIN_TRADE_USD && chain !== "cronos") {
          const funded = await tradingSnapshot(session.address, chain);
          if (!funded || funded.equityUsd < MIN_TRADE_USD) {
            const message = `Wallet needs at least $${MIN_TRADE_USD} of ${copy.needFunds} to trade.`;
            setError(message);
            setDesk((cur) => (cur ? { ...cur, bot: { ...cur.bot, running: false, lastNote: message } } : cur));
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
      const message = e instanceof Error ? e.message : "Control failed";
      setError(message);
      if (action === "start" || action === "stop") {
        setDesk((cur) =>
          cur
            ? { ...cur, bot: { ...cur.bot, running: action === "stop" ? true : false, lastNote: message } }
            : cur,
        );
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      void publishRunner();
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
      void publishRunner();
    }
  };

  const saveConfig = async (config: Partial<BotConfig>) => {
    if (!wallet) return;
    if (chain === "solana" && config.walletSwaps && !isLiveSessionArmed()) {
      setArmAfterLive(false);
      setPendingLiveConfig(config);
      setLiveConfirm(true);
      return;
    }
    if (chain === "solana" && config.walletSwaps === false) {
      setBusy(true);
      try {
        applyDesk(await setPaperMode(chain));
        if (Object.keys(config).some((key) => key !== "walletSwaps" && key !== "executionMode")) {
          applyDesk(await configureBot({ ...config, walletSwaps: false, executionMode: "paper" }, chain));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Config failed");
      } finally {
        setBusy(false);
        void publishRunner();
      }
      return;
    }
    setBusy(true);
    try {
      applyDesk(await configureBot(config, chain));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Config failed");
    } finally {
      setBusy(false);
      void publishRunner();
    }
  };

  const requestLive = () => {
    setArmAfterLive(false);
    setPendingLiveConfig(null);
    setLiveConfirm(true);
  };

  const finishLiveConfirm = async () => {
    if (!wallet) return;
    setBusy(true);
    try {
      const unlocked = await confirmLiveMode(chain);
      applyDesk(
        desk
          ? { ...desk, config: unlocked.config, bot: unlocked.bot, liveSessionArmed: true }
          : unlocked,
        { keepError: true },
      );
      if (pendingLiveConfig) {
        applyDesk(await configureBot({ ...pendingLiveConfig, walletSwaps: true, executionMode: "live", killSwitch: false }, chain));
      }
      const startBot = armAfterLive;
      setArmAfterLive(false);
      setPendingLiveConfig(null);
      setLiveConfirm(false);
      setBusy(false);
      if (startBot) await control("start");
      return;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not arm LIVE");
    } finally {
      setBusy(false);
      void publishRunner();
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
      void publishRunner();
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
      void publishRunner();
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
  const solPx = desk?.regime.sol.price || nativeRow?.price || wallet?.solPriceUsd || 0;
  const solChg = desk?.regime.sol.price ? desk.regime.sol.change24h : nativeRow?.candidate.flows.h24.priceChangePct;
  const cronosHeld = chain === "cronos" && wallet ? croHoldings(wallet, solPx || 0) : null;
  const cronosMark = cronosHeld?.usd ?? 0;
  useEffect(() => {
    if (!wallet || !desk || cronosMark < MIN_TRADE_USD) return;
    if (desk.positions.length > 0 || desk.trades.length > 0) return;
    if (desk.portfolio.equityUsd >= MIN_TRADE_USD) return;
    let cancelled = false;
    void attachWallet(wallet.address, cronosMark, chain).then(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [chain, cronosMark, desk, refresh, wallet]);
  const solArmed = chain === "solana" ? Boolean(desk?.bot.running) : peerArmed;
  const croArmed = chain === "cronos" ? Boolean(desk?.bot.running) : peerArmed;
  const shownWallet =
    wallet ??
    (savedAddress && desk ? previewDeskSession(chain, savedAddress, desk.portfolio.equityUsd) : null);
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

  if (!shownWallet) {
    return (
      <div className="min-h-dvh overflow-y-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10">
        <div className="mx-auto w-full max-w-xl">
        <div className="neon boot-fade w-full max-w-xl p-5 sm:p-10">
          <div className="orb mb-6 grid place-items-center text-lg font-semibold text-[var(--accent-ink)]">T8</div>
          <div className="mb-5 flex justify-end">
            <ChainSwitch chain={chain} solArmed={solArmed} croArmed={croArmed} onSwitch={switchChain} />
          </div>
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--magenta)]">T-800 // {copy.kicker}</div>
          <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-5xl">
            {chain === "solana" ? "Connect a wallet to start trading" : "Connect a wallet to arm the desk"}
          </h1>
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
            {chain === "solana" ? (
              <>
                <GateChip label="Real prices" hint="CoinGecko · GeckoTerminal · Jupiter" />
                <GateChip label="Practice first" hint="No money moves until you choose" />
                <GateChip label="You keep control" hint="No seed phrase, ever" />
              </>
            ) : (
              <>
                <GateChip label="Live marks" hint="CoinGecko · GeckoTerminal" />
                <GateChip label="Wallet book" hint={`${copy.walletBook} only`} />
                <GateChip label="Live swaps" hint={copy.swapHint} />
              </>
            )}
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

  const homeOnPhone = tab === "home";

  return (
    <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
        <Header
        desk={desk}
        wallet={shownWallet}
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
        onWatch={() => openWatch(shownWallet.address)}
        trading={trading}
      />

      <div className="mx-auto grid w-full min-w-0 max-w-[1500px] grid-cols-1 gap-3 px-3 py-3 sm:px-4 lg:grid-cols-[200px_1fr]">
        <aside className="neon h-fit min-w-0 p-2 sm:p-3 lg:sticky lg:top-20">
          <div className="flex flex-wrap gap-1 lg:block">
          {navFor().map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              data-active={tab === item.id}
              onClick={() => {
                setTab(item.id);
                setThesis(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="nav-item mb-1 flex w-auto items-center justify-between whitespace-nowrap px-3 py-2 text-left hover:bg-[var(--nav-hover)] lg:w-full"
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
            } ${homeOnPhone ? "max-lg:hidden" : ""}`}
          >
            {chain === "solana" ? (desk?.bot.running ? "Stop bot" : "Start bot") : desk?.bot.running ? "Disarm bot" : "Arm bot"}
          </button>
          {error ? <p className="mt-2 px-2 text-[11px] leading-5 text-[var(--crimson)]">{error}</p> : null}
          {chain === "solana" && (desk?.config.walletSwaps || desk?.config.killSwitch) ? (
            <button
              disabled={busy || !desk}
              onClick={() => void control("kill")}
              className="btn mt-2 w-full bg-[var(--danger-soft)] text-[var(--crimson)]"
            >
              Emergency stop
            </button>
          ) : null}
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
          {desk?.bot.lastNote ? (
            <p className={`mt-3 line-clamp-2 px-2 text-[11px] leading-5 text-[var(--magenta)] ${homeOnPhone ? "max-lg:hidden" : ""}`}>
              {desk.bot.lastNote}
            </p>
          ) : null}
          <p className={`mt-2 break-words px-2 text-[11px] leading-5 text-[var(--faint)] ${homeOnPhone ? "max-lg:hidden" : ""}`}>
            {trading
              ? chain === "cronos"
                ? `${trading.sol.toFixed(3)} CRO EVM · ${trading.usdc.toFixed(2)} USDC on the trading key ${shortAddress(trading.address)}. Disarm asks the Onchain extension to sign before this balance returns.`
                : `${trading.sol.toFixed(3)} ${copy.native} · ${trading.usdc.toFixed(2)} USDC on the trading key ${shortAddress(trading.address)}. Arm signed once. That key sends the swaps.`
              : cronosHeld
                ? cronosHeld.cro > 0 || cronosHeld.pos > 0 || shownWallet.usdc > 0
                  ? cronosHeld.onPos
                    ? `${formatCro(cronosHeld.pos)} is on Cronos POS. In the Onchain wallet, send it to Cronos EVM before Arm can move it.`
                    : `${formatCro(cronosHeld.cro)} on Cronos EVM · ${shownWallet.usdc.toFixed(2)} USDC. Arm and disarm ask the Onchain extension to sign.`
                  : "No CRO or USDC on this Cronos account. In the Onchain wallet, switch to Cronos EVM and choose the account that holds the CRO."
                : !wallet
                  ? desk?.bot.running
                    ? "Wallet is reconnecting. The bot is still running."
                    : "Wallet is reconnecting."
                : `${shownWallet.sol.toFixed(3)} ${copy.native} · ${shownWallet.usdc.toFixed(2)} USDC. ${
                    desk?.config.walletSwaps ? "Arm signs once. That signature sends the swaps." : "Fills stay in this browser."
                  }`}
          </p>
          <button onClick={() => void disconnect()} className="mt-2 min-h-11 px-2 text-[11px] uppercase tracking-[0.16em] text-[var(--faint)] sm:hidden">
            Disconnect
          </button>
        </aside>

        <main className="min-w-0 space-y-3 pt-1">
          {error ? (
            <div className="rounded-[18px] border border-[var(--danger-line)] bg-[var(--danger-fill)] px-4 py-3 text-sm text-[var(--crimson)]">
              {error}
            </div>
          ) : null}
          {desk && !wallet ? (
            <div className="rounded-[18px] border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted)]">
              {desk.bot.running
                ? "Wallet is reconnecting. The bot kept running through the refresh."
                : "Wallet is reconnecting. Your book is still here."}
            </div>
          ) : null}

          {!desk ? (
            <BootSkeleton address={shownWallet.address} />
          ) : (
            <div key={tab} className="tab-in">
              {tab === "home" ? (
                <Home
                  desk={desk}
                  chain={chain}
                  balanceUsd={
                    desk.config.walletSwaps
                      ? trading?.equityUsd || cronosHeld?.usd || shownWallet.equityUsd
                      : desk.positions.length === 0 && desk.trades.length === 0
                        ? Math.max(desk.portfolio.equityUsd, cronosHeld?.usd ?? shownWallet.equityUsd)
                        : desk.portfolio.equityUsd
                  }
                  busy={busy}
                  closingId={closingId}
                  closeError={closeError}
                  onStartStop={() => void control(desk.bot.running ? "stop" : "start")}
                  onMode={(real) => (real ? requestLive() : void saveConfig({ walletSwaps: false, executionMode: "paper" }))}
                  onClose={(id) => void closePos(id)}
                  onOpenPosition={setDetailId}
                  onMore={() => setTab("risk")}
                  runner={runnerHost}
                />
              ) : null}
              {tab === "overview" ? (
                <Overview
                  desk={desk}
                  wallet={shownWallet}
                  trading={trading}
                  winRate={winRate}
                  focusMint={focusMint}
                  chain={chain}
                  onFocus={setFocusMint}
                  onOpen={setThesis}
                  onOpenPosition={setDetailId}
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
                  wallet={shownWallet}
                  trading={trading}
                  winRate={winRate}
                  busy={busy}
                  closingId={closingId}
                  closeError={closeError}
                  onOpenPosition={setDetailId}
                  onClose={closePos}
                  onFlatten={() => void control("flatten")}
                  onWalletSwaps={(on) => (on ? requestLive() : void saveConfig({ walletSwaps: false, executionMode: "paper" }))}
                  onWithdraw={() => void withdrawProfit()}
                />
              ) : null}
              {tab === "risk" ? <SettingsPanel chain={chain} desk={desk} busy={busy} onSave={saveConfig} onReset={() => void control("reset")} /> : null}
            </div>
          )}
          {desk ? (
            <div className="cmd hidden sm:block">
              {chain === "solana"
                ? "1–6 pages · Space start or stop · R refresh · F sell everything · Esc close"
                : "1–6 pages · Space arm · R refresh · F flatten · Esc close"}
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
      {liveConfirm ? (
        <LiveConfirmModal
          chain={chain}
          busy={busy}
          onCancel={() => {
            setLiveConfirm(false);
            setArmAfterLive(false);
            setPendingLiveConfig(null);
          }}
          onConfirm={() => void finishLiveConfirm()}
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

function LiveConfirmModal({
  chain,
  busy,
  onCancel,
  onConfirm,
}: {
  chain: ChainId;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [acked, setAcked] = useState(false);
  const ready = typed.trim().toUpperCase() === "LIVE" && acked;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4">
      <div className="neon w-full max-w-lg p-6">
        <h2 className="text-xl font-medium">{chain === "cronos" ? "Enable LIVE WolfSwap and cro.trade swaps" : "Enable LIVE Jupiter swaps"}</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          {chain === "cronos"
            ? "PAPER stays the default. LIVE spends real USDC or CRO from the trading key after you arm, whichever you pick in Settings. You can lose that money plus CRO fees. The bot only buys and sells."
            : "PAPER stays the default. LIVE spends real USDC from the trading key after you arm. You can lose that USDC plus SOL fees. The bot only buys and sells. A reload locks LIVE until you type LIVE again."}
        </p>
        <label className="mt-4 flex items-start gap-3 text-sm text-[var(--text)]">
          <input type="checkbox" className="mt-1" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
          <span>I understand this can lose money and is not financial advice.</span>
        </label>
        <label className="mt-4 block text-sm">
          <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">Type LIVE</span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-black/30 px-3 py-2"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="mt-5 flex flex-wrap gap-2">
          <button disabled={busy || !ready} onClick={onConfirm} className="btn btn-magenta">
            Arm LIVE this session
          </button>
          <button disabled={busy} onClick={onCancel} className="btn btn-ghost">
            Stay on PAPER
          </button>
        </div>
      </div>
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
      className={`chain-pill flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.12em] sm:min-h-0 sm:py-1 sm:tracking-[0.16em] ${
        chain === id ? "chain-pill-on bg-[var(--accent-soft)] text-[var(--magenta)]" : "text-[var(--faint)]"
      }`}
    >
      {armed ? <span className="pulse-dot shrink-0 bg-[var(--mint)] text-[var(--mint)]" /> : null}
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
  trading: { equityUsd: number; sol?: number } | null;
}) {
  const armed = Boolean(desk?.bot.running);
  const holdings = chain === "cronos" ? croHoldings(wallet, solPx) : null;
  const croEvm = trading && chain === "cronos" ? (trading.sol ?? 0) : holdings?.cro ?? 0;
  const equity = holdings ? formatCroEvm(croEvm) : usd(trading ? trading.equityUsd : wallet.equityUsd);
  const equityNote = holdings
    ? trading
      ? trading.equityUsd > 0
        ? usd(trading.equityUsd)
        : null
      : holdings.onPos
        ? `${formatCro(holdings.pos)} on Cronos POS. Send it to Cronos EVM to trade.`
        : holdings.usd > 0
          ? usd(holdings.usd)
          : holdings.cro === 0
            ? "No CRO on Cronos EVM"
            : null
    : null;
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--header)] pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex w-full min-w-0 max-w-[1500px] flex-col gap-2 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="brand-mark grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-semibold text-[var(--magenta)]">
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
            <button onClick={onRefresh} className="header-chip text-[11px] uppercase tracking-[0.16em]">
              Refresh
            </button>
            <button onClick={onWatch} className="header-chip text-[11px] uppercase tracking-[0.16em]">
              Watch
            </button>
            <Pill tone="magenta">{shortAddress(wallet.address)}</Pill>
            <Pill
              tone={
                desk?.config.walletSwaps ? (chain === "cronos" || desk.liveSessionArmed ? "mint" : "magenta") : "default"
              }
            >
              {desk?.config.walletSwaps ? (chain === "cronos" || desk.liveSessionArmed ? "LIVE" : "LIVE locked") : "PAPER"}
            </Pill>
            <Pill tone={armed ? "mint" : "default"}>
              <span className={`pulse-dot ${armed ? "bg-[var(--mint)] text-[var(--mint)]" : "bg-[var(--faint)] text-[var(--faint)]"}`} />
              {armed ? "Armed" : "Standby"}
            </Pill>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">{trading ? "Trading" : "Wallet"}</div>
              <div className="num">{equity}</div>
              {equityNote ? <div className="text-[10px] text-[var(--faint)]">{equityNote}</div> : null}
            </div>
            <button onClick={onDisconnect} className="header-chip text-[11px] uppercase tracking-[0.16em]">
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
            {equityNote ? <div className="text-[10px] text-[var(--faint)]">{equityNote}</div> : null}
          </div>
          <button onClick={onRefresh} className="header-chip min-h-11 shrink-0 text-[11px] uppercase tracking-[0.14em]">
            Refresh
          </button>
          <button onClick={onWatch} className="header-chip min-h-11 shrink-0 text-[11px] uppercase tracking-[0.14em]">
            Watch
          </button>
          <button onClick={onDisconnect} className="header-chip min-h-11 shrink-0 text-[11px] uppercase tracking-[0.14em]">
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
  const label = side === "short" ? "sell" : "buy";
  return leverage && leverage > 1 ? `${label} ${leverage}x` : label;
}

function rowPnl(position: Position): number {
  const pnlPct = ((position.markPrice - position.entryPrice) / position.entryPrice) * 100 * (position.side === "long" ? 1 : -1);
  return position.qty * position.entryPrice * (pnlPct / 100);
}

function PositionRail({ positions, onOpen }: { positions: Position[]; onOpen: (id: string) => void }) {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {positions.map((p) => {
        const pnlPct = ((p.markPrice - p.entryPrice) / p.entryPrice) * 100 * (p.side === "long" ? 1 : -1);
        return (
          <button key={p.id} type="button" onClick={() => onOpen(p.id)} className="pos-card neon p-4 text-left">
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
            <div className="mt-2 text-[10px] uppercase tracking-[0.16em] text-[var(--faint)]">Open ticket</div>
          </button>
        );
      })}
    </section>
  );
}

function RangeBar({ position }: { position: Position }) {
  const pts = [position.stopPrice, position.entryPrice, position.markPrice, position.targetPrice];
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pctOf = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const x = (v: number) => `${pctOf(v)}%`;
  const entry = pctOf(position.entryPrice);
  const mark = pctOf(position.markPrice);
  const winning = position.side === "long" ? position.markPrice >= position.entryPrice : position.markPrice <= position.entryPrice;
  return (
    <div className="range-track" title="Stop · entry · mark · target">
      <span
        className="range-fill"
        style={{
          left: `${Math.min(entry, mark)}%`,
          width: `${Math.abs(mark - entry)}%`,
          background: winning ? "var(--mint)" : "var(--crimson)",
        }}
      />
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

type FrameBars = Partial<Record<Frame, Candle[]>>;

function useFrameCharts(mints: string[], chain: ChainId, extra: Frame[] = []): Record<string, FrameBars> {
  const key = mints.join("|");
  const extraKey = extra.join("|");
  const [bars, setBars] = useState<Record<string, FrameBars>>({});
  useEffect(() => {
    if (!key) return;
    const ids = key.split("|").filter(Boolean);
    const more = extraKey.split("|").filter((frame): frame is Frame => frame === "5m");
    let live = true;
    const paint = () => {
      if (!live) return;
      requestFrameCharts(ids, chain, more);
      setBars((cur) => {
        let changed = false;
        const next = { ...cur };
        for (const mint of ids) {
          for (const frame of FRAMES) {
            const rows = cachedFrameChart(mint, chain, frame);
            if (!rows?.length || next[mint]?.[frame] === rows) continue;
            next[mint] = { ...next[mint], [frame]: rows };
            changed = true;
          }
        }
        return changed ? next : cur;
      });
    };
    paint();
    const id = setInterval(paint, 500);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [chain, extraKey, key]);
  return bars;
}

function FrameTabs({ value, onChange, label }: { value: Frame; onChange: (frame: Frame) => void; label: string }) {
  return (
    <span role="tablist" aria-label={label} className="flex gap-1">
      {FRAMES.map((frame) => (
        <button
          key={frame}
          type="button"
          role="tab"
          aria-selected={value === frame}
          data-on={value === frame}
          onClick={(event) => {
            event.stopPropagation();
            onChange(frame);
          }}
          className="filter-chip num"
        >
          {frame}
        </button>
      ))}
    </span>
  );
}

const BIAS_WORD: Record<Bias, string> = { up: "Up", down: "Down", range: "Range" };
const BIAS_TONE: Record<Bias, "mint" | "crimson" | "amber"> = { up: "mint", down: "crimson", range: "amber" };

/** What the bot sees on each frame for one coin: 15m finds the trade, 1h and 4h must agree. */
function BotRead({ frames, call }: { frames: FrameBars; call: string }) {
  const role: Record<Frame, string> = { "5m": "context", "15m": "entry", "1h": "back-check", "4h": "back-check" };
  return (
    <div className="mb-2 rounded-xl border border-[var(--line)] p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {FRAMES.map((frame) => {
          const bias = frameBias(frames[frame]);
          return (
            <span key={frame} className="flex items-center gap-1 text-[11px]">
              <span className="num uppercase tracking-[0.12em] text-[var(--faint)]">{frame}</span>
              {bias ? <Pill tone={BIAS_TONE[bias]}>{BIAS_WORD[bias]}</Pill> : <Pill>loading</Pill>}
              <span className="text-[10px] text-[var(--faint)]">{role[frame]}</span>
            </span>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs leading-5 text-[var(--text)]">
        <span className="text-[var(--faint)]">Bot: </span>
        {call}
      </p>
    </div>
  );
}

function TaToggles({ layers, onChange }: { layers: TaLayers; onChange: (next: TaLayers) => void }) {
  const items: [keyof TaLayers, string, "magenta" | "ice" | "amber"][] = [
    ["emas", "EMA 9/21/50", "magenta"],
    ["vwap", "VWAP", "amber"],
    ["levels", "Support / resistance", "ice"],
    ["trendlines", "Trendlines", "ice"],
    ["fib", "Fibonacci", "amber"],
    ["swings", "Swings HH/HL", "magenta"],
  ];
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map(([id, label, tone]) => (
        <LegendToggle key={id} on={layers[id]} tone={tone} label={label} onClick={() => onChange({ ...layers, [id]: !layers[id] })} />
      ))}
    </span>
  );
}

function LegendToggle({
  on,
  tone,
  label,
  onClick,
}: {
  on: boolean;
  tone: "magenta" | "ice" | "amber";
  label: string;
  onClick: () => void;
}) {
  const color = tone === "magenta" ? "var(--magenta)" : tone === "ice" ? "var(--ice)" : "var(--amber)";
  return (
    <button type="button" aria-pressed={on} data-on={on} onClick={onClick} className="legend-toggle" style={{ color }}>
      {label}
    </button>
  );
}

function ScoreMeter({ score }: { score: number }) {
  const width = Math.max(4, Math.min(100, score));
  const color = score >= 70 ? "var(--mint)" : score >= 55 ? "var(--amber)" : "var(--crimson)";
  return (
    <span className="score-track" aria-hidden="true">
      <span style={{ width: `${width}%`, background: color }} />
    </span>
  );
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
  onOpenPosition,
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
  onOpenPosition: (id: string) => void;
  onArm: () => void;
  busy: boolean;
}) {
  const [layers, setLayers] = useState<ChartLayers>({ ema9: true, ema21: true, vwap: true });
  const [taLayers, setTaLayers] = useState<TaLayers>(ALL_TA_LAYERS);
  const [focusFrame, setFocusFrame] = useState<Frame>("4h");
  const [chartFrame, setChartFrame] = useState<Frame>("4h");
  const [gridFrame, setGridFrame] = useState<Frame>("15m");
  const [tapeFilter, setTapeFilter] = useState<"all" | "live" | "up" | "down">("all");
  const [noteOpen, setNoteOpen] = useState(false);
  const [chartMint, setChartMint] = useState<string | null>(null);
  const [priceTick, setPriceTick] = useState(0);
  const [priceDir, setPriceDir] = useState<"up" | "down" | null>(null);
  const lastPrice = useRef<number | null>(null);
  const copy = CHAIN_COPY[chain];
  const focus = desk.research.find((r) => sameMint(r.candidate.mint, focusMint ?? "")) ?? desk.research[0] ?? null;
  const book = bookTokens(chain);
  const bars = useFrameCharts(book.map((token) => token.mint), chain, [focusFrame, chartFrame, gridFrame]);
  const openToken = (mint: string) => {
    onFocus(mint);
    if (book.some((token) => token.mint === mint || token.mint.toLowerCase() === mint.toLowerCase())) setChartMint(mint);
  };
  useEffect(() => {
    for (const tape of desk.tapes) {
      if (tape.poolAddress && tape.price) rememberTapeMark(tape.poolAddress, tape.price);
    }
  }, [desk.tapes]);
  const focusPrice = focus?.price ?? null;
  useEffect(() => {
    const prev = lastPrice.current;
    if (prev !== null && focusPrice !== null && prev !== focusPrice) {
      setPriceDir(focusPrice >= prev ? "up" : "down");
      setPriceTick((tick) => tick + 1);
    }
    lastPrice.current = focusPrice;
  }, [focusPrice]);
  const matchedTape = desk.tapes.find((tape) => tape.mint === focus?.candidate.mint) ?? null;
  const focusTape = matchedTape ?? desk.tapes[0] ?? null;
  const focusName =
    matchedTape?.symbol ?? book.find((token) => token.mint === focus?.candidate.mint)?.symbol ?? focusTape?.symbol;
  const focusMintKey =
    book.find((token) => token.mint === focus?.candidate.mint || token.mint.toLowerCase() === focus?.candidate.mint.toLowerCase())?.mint ??
    focus?.candidate.mint ??
    null;
  const focusCandles = focusMintKey ? (bars[focusMintKey]?.[focusFrame] ?? []) : [];
  const chartToken = chartMint ? book.find((token) => token.mint === chartMint || token.mint.toLowerCase() === chartMint.toLowerCase()) : null;
  const chartFrames: FrameBars = chartMint ? (bars[chartToken?.mint ?? chartMint] ?? {}) : {};
  const chartCandles = chartFrames[chartFrame] ?? [];
  const feed = chain === "solana" ? "Jupiter" : "GeckoTerminal";
  const emptyFor = (frame: Frame) => `Waiting on the ${feed} ${FRAME_LABEL[frame]} chart`;
  const chartEmpty = emptyFor(gridFrame);
  const tradeOn = (mint: string | null | undefined): ChartTrade | null => {
    if (!mint) return null;
    const pos = desk.positions.find((row) => sameMint(row.mint, mint));
    return pos ? { side: pos.side, entry: pos.entryPrice, stop: pos.stopPrice, target: pos.targetPrice } : null;
  };
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
    <div className="space-y-3">
      {chartMint ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={() => setChartMint(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={chartToken ? `${tapeLabel(chartToken.symbol)} ${FRAME_LABEL[chartFrame]} chart` : "Chart"}
            className="neon max-h-[94vh] w-full max-w-5xl overflow-y-auto p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-medium">{chartToken ? tapeLabel(chartToken.symbol) : "Chart"}</div>
                <p className="text-sm text-[var(--muted)]">
                  {feed} {FRAME_LABEL[chartFrame]} chart.{" "}
                  {chartFrame === "15m"
                    ? "The bot finds its buy setups on this chart."
                    : chartFrame === "4h"
                      ? "The bot's technical read is drawn on the chart. A 15-minute trade must not fight this trend."
                      : chartFrame === "1h"
                        ? "A 15-minute trade must not fight this trend."
                        : "Short-term context for the 15-minute setup."}
                  {chartCandles.length ? ` ${chartCandles.length} bars.` : ""}
                </p>
              </div>
              <button type="button" className="btn px-3 py-1" onClick={() => setChartMint(null)}>
                Close
              </button>
            </div>
            <BotRead
              frames={chartFrames}
              call={chartToken ? (assetCall(chartToken.symbol, desk.signals, desk.bot.blocked ?? []) || "Waiting for the next check.") : "—"}
            />
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <FrameTabs value={chartFrame} onChange={setChartFrame} label="Chart timeframe" />
              {chartFrame === "4h" ? (
                <TaToggles layers={taLayers} onChange={setTaLayers} />
              ) : (
                <span className="flex gap-1.5">
                  <LegendToggle on={layers.ema9} tone="magenta" label="EMA 9" onClick={() => setLayers((cur) => ({ ...cur, ema9: !cur.ema9 }))} />
                  <LegendToggle on={layers.ema21} tone="ice" label="EMA 21" onClick={() => setLayers((cur) => ({ ...cur, ema21: !cur.ema21 }))} />
                  <LegendToggle on={layers.vwap} tone="amber" label="VWAP" onClick={() => setLayers((cur) => ({ ...cur, vwap: !cur.vwap }))} />
                </span>
              )}
            </div>
            {chartFrame === "4h" ? (
              <>
                <div className="h-[min(62vh,540px)]">
                  <AnalysisChart candles={chartCandles} layers={taLayers} trade={tradeOn(chartToken?.mint)} emptyLabel={emptyFor("4h")} />
                </div>
                <TaNotes candles={chartCandles} />
              </>
            ) : (
              <div className="h-[420px]">
                <CandleChart candles={chartCandles} layers={layers} emptyLabel={emptyFor(chartFrame)} />
              </div>
            )}
          </div>
        </div>
      ) : null}
      <section className="neon overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(200px,250px)_minmax(0,1fr)]">
          <div className="flex flex-col p-3">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]">
                <span>{focus ? focus.ticker : book[0] ? tapeLabel(book[0].symbol) : "Waiting"}</span>
                <Pill tone="magenta">
                  <span className="pulse-dot bg-[var(--magenta)] text-[var(--magenta)]" />
                  Live
                </Pill>
              </div>
              <div key={priceTick} className={`hero-price mt-2 num text-3xl ${priceDir === "up" ? "price-up" : priceDir === "down" ? "price-down" : ""}`}>
                {focus ? priceFmt(focus.price) : "—"}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {focus ? <Tone value={focus.candidate.flows.h24.priceChangePct} /> : <span className="text-[var(--faint)]">Waiting on live pools</span>}
                {matchedTape ? (
                  <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
                    5m {matchedTape.change5m !== undefined ? <Tone value={matchedTape.change5m} /> : "—"} · 15m <Tone value={matchedTape.change15m} />
                  </span>
                ) : null}
              </div>
              {book.length > 1 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {book.map((token) => (
                    <button
                      key={token.mint}
                      onClick={() => openToken(token.mint)}
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        sameMint(token.mint, focus?.candidate.mint ?? focusMint ?? "")
                          ? "bg-[var(--accent-soft)] text-[var(--magenta)]"
                          : "text-[var(--faint)] hover:text-[var(--text)]"
                      }`}
                    >
                      {tapeLabel(token.symbol)}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex items-end justify-between gap-2">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">Open now</div>
                  <div className="num text-xl">{open.length}</div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {fills.length} in the history · hit {winRate.toFixed(0)}%
                  </div>
                </div>
                <Spark values={equitySeries} />
              </div>
              <button
                disabled={busy}
                onClick={onArm}
                className={`btn mt-3 w-full py-2 ${desk.bot.running ? "bg-[var(--danger-soft)] text-[var(--crimson)]" : "btn-magenta"}`}
              >
                {armButton(desk.bot.running).label}
              </button>
            </div>
            <div className="border-t border-[var(--line)] p-2 lg:border-t-0 lg:border-l">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
                <button
                  type="button"
                  onClick={() => {
                    if (!focusMintKey) return;
                    setChartFrame(focusFrame);
                    openToken(focusMintKey);
                  }}
                  className="uppercase tracking-[0.16em]"
                >
                  {focusName ? `${tapeLabel(focusName)} ${focusFrame} · open chart` : `${focusFrame} chart`}
                </button>
                <span className="flex flex-wrap gap-1.5 tracking-normal normal-case">
                  <FrameTabs value={focusFrame} onChange={setFocusFrame} label="Main chart timeframe" />
                  {focusFrame === "4h" ? null : (
                    <>
                      <LegendToggle on={layers.ema9} tone="magenta" label="EMA 9" onClick={() => setLayers((cur) => ({ ...cur, ema9: !cur.ema9 }))} />
                      <LegendToggle on={layers.ema21} tone="ice" label="EMA 21" onClick={() => setLayers((cur) => ({ ...cur, ema21: !cur.ema21 }))} />
                      <LegendToggle on={layers.vwap} tone="amber" label="VWAP" onClick={() => setLayers((cur) => ({ ...cur, vwap: !cur.vwap }))} />
                    </>
                  )}
                </span>
              </div>
              <div className={`block w-full ${focusFrame === "4h" ? "h-[360px]" : "h-[280px]"}`}>
                {focusFrame === "4h" ? (
                  <AnalysisChart candles={focusCandles} layers={taLayers} trade={tradeOn(focusMintKey)} emptyLabel={emptyFor("4h")} />
                ) : (
                  <CandleChart candles={focusCandles} layers={layers} emptyLabel={emptyFor(focusFrame)} />
                )}
              </div>
            </div>
        </div>
      </section>

      <section className="neon p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="flex flex-wrap items-center gap-2">
            <Label>{FRAME_LABEL[gridFrame]} charts</Label>
            <FrameTabs value={gridFrame} onChange={setGridFrame} label="Coin chart timeframe" />
          </span>
          <span className="text-[11px] text-[var(--faint)]">
            {desk.bot.lastTickAt ? `Tick ${desk.bot.ticks} · ${new Date(desk.bot.lastTickAt).toLocaleTimeString()}` : "Waiting for tick 1"}
          </span>
        </div>
        <button
          type="button"
          aria-expanded={noteOpen}
          onClick={() => setNoteOpen((open) => !open)}
          className={`mb-2 w-full px-1 text-left text-xs leading-5 text-[var(--text)] ${noteOpen ? "" : "line-clamp-2"}`}
        >
          {desk.bot.lastNote ?? copy.waitingTick}
        </button>
        <div className="mb-2 flex flex-wrap gap-1.5 px-1">
          {(
            [
              ["all", "All"],
              ["live", "Signaling"],
              ["up", "15m up"],
              ["down", "15m down"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tapeFilter === id} data-on={tapeFilter === id} onClick={() => setTapeFilter(id)} className="filter-chip">
              {label}
            </button>
          ))}
        </div>
        <div className={bookTokens(chain).length > 3 ? "tape-grid" : bookTokens(chain).length > 1 ? "grid gap-2 sm:grid-cols-2" : ""}>
          {bookTokens(chain).filter((token) => {
            const tape = desk.tapes.find((row) => sameMint(row.mint, token.mint));
            const live = desk.signals.some((row) => row.symbol === token.symbol);
            if (tapeFilter === "live") return live;
            if (tapeFilter === "up") return (tape?.change15m ?? 0) > 0.05;
            if (tapeFilter === "down") return (tape?.change15m ?? 0) < -0.05;
            return true;
          }).map((token) => {
            const symbol = token.symbol;
            const tape = desk.tapes.find((row) => sameMint(row.mint, token.mint));
            const call = assetCall(symbol, desk.signals, desk.bot.blocked ?? []);
            const live = desk.signals.some((row) => row.symbol === symbol);
            const price =
              tape?.price ??
              token.priceUsd ??
              ((token.symbol === "SOL" || token.symbol === "CRO") && desk.regime.sol.price > 0
                ? desk.regime.sol.price
                : undefined) ??
              (token.symbol === "CRO" ? desk.research.find((row) => row.ticker === "CRO")?.price : undefined);
            const change5m = tape?.change5m ?? token.change5m;
            const selected = token.mint === (focus?.candidate.mint ?? focusTape?.mint);
            return (
              <button
                key={token.mint}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setChartFrame(gridFrame);
                  openToken(token.mint);
                }}
                className={`tape-card rounded-2xl border p-2 text-left ${selected ? "tape-card-on" : ""} ${live ? "tape-card-live" : ""}`}
              >
                <div className="mb-1 flex items-baseline justify-between gap-2 px-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {live ? <span className="pulse-dot bg-[var(--mint)] text-[var(--mint)]" /> : null}
                    {tapeLabel(symbol)}
                  </span>
                  <span className="num text-lg text-[var(--text)]">{price ? priceFmt(price) : "—"}</span>
                </div>
                <div className="mb-1 flex items-center justify-end gap-2 px-1 text-[11px]">
                  <span className="uppercase tracking-[0.12em] text-[var(--faint)]">5m</span>
                  {change5m !== undefined ? <Tone value={change5m} /> : <span className="text-[var(--faint)]">—</span>}
                  <span className="uppercase tracking-[0.12em] text-[var(--faint)]">15m</span>
                  {tape ? <Tone value={tape.change15m} /> : <span className="text-[var(--faint)]">—</span>}
                </div>
                <p className={`mb-1 line-clamp-2 px-1 text-xs leading-4 ${live ? "text-[var(--mint)]" : "text-[var(--muted)]"}`}>{call}</p>
                <div className="h-[112px]">
                  <CandleChart candles={bars[token.mint]?.[gridFrame] ?? []} layers={layers} emptyLabel={chartEmpty} />
                </div>
              </button>
            );
          })}
        </div>
        {tapeFilter !== "all" && bookTokens(chain).every((token) => {
          const tape = desk.tapes.find((row) => sameMint(row.mint, token.mint));
          const live = desk.signals.some((row) => row.symbol === token.symbol);
          if (tapeFilter === "live") return !live;
          if (tapeFilter === "up") return !((tape?.change15m ?? 0) > 0.05);
          return !((tape?.change15m ?? 0) < -0.05);
        }) ? (
          <p className="px-1 pb-2 text-sm text-[var(--muted)]">Nothing in this cut right now.</p>
        ) : null}
      </section>

      {open.length ? <PositionRail positions={open} onOpen={onOpenPosition} /> : null}

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
            Universe {desk.universeSize || "—"} · screened {desk.eliminated || "—"} · scored {desk.candidatesScanned || "—"} · click a name to focus it
          </span>
        </div>
        <div className="h-[150px]">
          <ScatterTape dots={desk.tapeDots} onPick={openToken} />
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="neon p-3">
          <Label>Wallet equity curve</Label>
          <div className="h-[88px]">
            <EquityPath values={equitySeries} />
          </div>
        </div>
        <div className="neon p-3">
          <Label>Pool volume</Label>
          <div className="h-[88px]">
            <VolumeBars candles={focusCandles} />
          </div>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="neon p-3">
          <div className="flex items-center justify-between">
            <Pill tone={stanceTone}>{desk.regime.stance.replace("-", " ")}</Pill>
            <span className="text-xs text-[var(--faint)]">{shortAddress(wallet.address)}</span>
          </div>
          <p className="mt-2 text-sm leading-5 text-[var(--muted)]">{desk.regime.overview}</p>
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
        <div className="neon p-3">
          <Label>Execution log</Label>
          <div className="mt-2">
            <ExecutionLog
              trades={fills}
              positions={open}
              chain={chain}
              empty={
                swaps
                  ? copy.noSwaps
                  : "No buys yet. Turn the bot on to practice in this browser. Real money is off, so nothing is sent."
              }
            />
          </div>
          {desk.signals.length ? (
            <div className="mt-3 space-y-1 text-[11px] text-[var(--faint)]">
              {desk.signals.slice(0, 4).map((s) => (
                <p key={s.id}>
                  Signal {s.symbol} {s.side} · {s.reason} · conf {s.confidence.toFixed(0)}
                </p>
              ))}
            </div>
          ) : null}
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

function coinRows(desk: DeskPayload, chain: ChainId) {
  return bookTokens(chain).map((token) => {
    const research = desk.research.find((row) => sameMint(row.candidate.mint, token.mint));
    const tape = desk.tapes.find((row) => sameMint(row.mint, token.mint));
    const signal = desk.signals.find((row) => row.symbol === token.symbol || sameMint(row.mint, token.mint));
    const blocked = (desk.bot.blocked ?? []).find((line) => line.startsWith(`${token.symbol}:`));
    const price = research?.price || tape?.price || token.priceUsd || 0;
    return {
      token,
      research,
      tape,
      signal,
      blocked,
      call: assetCall(token.symbol, desk.signals, desk.bot.blocked ?? []),
      price,
    };
  });
}

function Radar({ desk, chain, onOpen }: { desk: DeskPayload; chain: ChainId; onOpen: (t: ResearchThesis) => void }) {
  const coins = coinRows(desk, chain);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Coins</h2>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-[var(--muted)]">{CHAIN_COPY[chain].radar}</p>
      </div>
      <div className="space-y-3 md:hidden">
        {coins.map((coin) => {
          const r = coin.research;
          return (
            <button
              key={coin.token.mint}
              type="button"
              onClick={() => r && onOpen(r)}
              className="radar-card neon block w-full p-4 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{tapeLabel(coin.token.symbol)}</div>
                  <div className="text-[11px] text-[var(--faint)]">
                    {coin.token.name}
                    {r ? ` · ${venueLabel(venueForDex(r.candidate.dex))}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div className="num text-sm">{coin.price ? priceFmt(coin.price) : "—"}</div>
                    {r ? <div className="num text-[var(--magenta)]">{r.researchScore.toFixed(1)}</div> : null}
                  </div>
                  {r ? <ScoreRing score={r.researchScore} /> : null}
                </div>
              </div>
              {r ? (
                <div className="mt-3">
                  <ScoreMeter score={r.researchScore} />
                </div>
              ) : null}
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{r?.coreThesis ?? coin.call}</p>
              {coin.tape ? (
                <p className="mt-2 text-xs leading-5 text-[var(--text)]">
                  5m <Tone value={coin.tape.change5m ?? 0} /> · 15m <Tone value={coin.tape.change15m} />
                </p>
              ) : null}
              {coin.blocked ? <p className="mt-1 text-xs leading-5 text-[var(--crimson)]">{coin.blocked}</p> : null}
              {r ? <p className="mt-1 text-xs leading-5 text-[var(--crimson)]">{r.biggestRisk}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--faint)]">
                <span>{r?.sector ?? coin.token.sector}</span>
                {r ? <span>MC {usd(r.marketCap)}</span> : null}
                {r ? <span>{r.keyMetric}</span> : <span>Waiting on live tape</span>}
              </div>
            </button>
          );
        })}
      </div>
      <div className="neon desk-scroll hidden overflow-x-auto p-1 md:block">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3">Asset</th>
              <th>Ticker</th>
              <th>Price</th>
              <th>5m</th>
              <th>15m</th>
              <th>Market cap</th>
              <th>Sector</th>
              <th>Status</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {coins.map((coin) => {
              const r = coin.research;
              return (
                <tr
                  key={coin.token.mint}
                  tabIndex={r ? 0 : undefined}
                  onClick={() => r && onOpen(r)}
                  onKeyDown={(event) => {
                    if (!r) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(r);
                    }
                  }}
                  className={`radar-row border-t border-[var(--line)] ${r ? "cursor-pointer" : ""}`}
                >
                  <td className="px-4 py-3 font-medium">{coin.token.name}</td>
                  <td className="num">
                    {tapeLabel(coin.token.symbol)}
                    {r ? (
                      <span className="block text-[10px] font-sans text-[var(--faint)]">
                        {venueLabel(venueForDex(r.candidate.dex))}
                      </span>
                    ) : null}
                  </td>
                  <td className="num">
                    {coin.price ? priceFmt(coin.price) : "—"}
                    {r?.candidate.priceAgreement === "split" ? (
                      <span className="block text-[10px] uppercase tracking-wide text-[var(--crimson)]">feeds split</span>
                    ) : r?.candidate.priceAgreement === "agree" ? (
                      <span className="block text-[10px] text-[var(--faint)]">
                        {r.candidate.sources.filter((s) => s.endsWith(":price") || s.endsWith(":jlp-price")).length} feeds
                      </span>
                    ) : null}
                  </td>
                  <td className="num">{coin.tape?.change5m !== undefined ? <Tone value={coin.tape.change5m} /> : "—"}</td>
                  <td className="num">{coin.tape ? <Tone value={coin.tape.change15m} /> : "—"}</td>
                  <td className="num">{r ? usd(r.marketCap) : "—"}</td>
                  <td>{r?.sector ?? coin.token.sector}</td>
                  <td className="max-w-[320px] truncate text-[var(--muted)]">
                    {coin.signal ? coin.signal.thesis : coin.blocked ?? r?.coreThesis ?? coin.call}
                  </td>
                  <td className="pr-4">
                    {r ? (
                      <>
                        <div className="num text-[var(--magenta)]">{r.researchScore.toFixed(1)}</div>
                        <ScoreMeter score={r.researchScore} />
                      </>
                    ) : (
                      <span className="text-[var(--faint)]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
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
  const fills = shownFills(desk.trades, swaps);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Bot log</h2>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-[var(--muted)]">
          Every scan, skip, and fill for {CHAIN_COPY[chain].bookLabel}.
        </p>
      </div>
      <section className="neon p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Pill tone={desk.bot.running ? "mint" : "magenta"}>{desk.bot.running ? CHAIN_COPY[chain].scanning : "Idle"}</Pill>
            <p className="mt-2 max-w-2xl text-sm leading-5 text-[var(--muted)]">
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
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <Stat label="Ticks" value={desk.bot.ticks} sub={desk.bot.lastTickAt ? new Date(desk.bot.lastTickAt).toLocaleTimeString() : "—"} />
          <Stat
            label="Open now"
            value={open.length}
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
                <li key={b} className={b.includes("red") ? "text-[var(--crimson)]" : b.includes("green") ? "text-[var(--mint)]" : undefined}>
                  — {b}
                </li>
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
            <Label>History</Label>
            <span className="text-[11px] text-[var(--faint)]">{open.length} open now</span>
          </div>
          <div className="mt-3">
            <ExecutionLog
              trades={fills}
              positions={open}
              chain={chain}
              empty={swaps ? "No real buys yet. A buy from the trading wallet shows up here." : "No buys yet."}
            />
          </div>
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
                <p>No buy on this scan. A red 15-minute tape stays in cash.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {desk.signals.map((s) => (
                <div key={s.id} className="rounded-2xl border border-[var(--line)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      {s.symbol} <Pill tone={s.side === "long" ? "mint" : "crimson"}>{s.side === "long" ? "buy" : "sell"}</Pill>
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
          <Label>Coins this cycle</Label>
          <div className="space-y-2">
            {coinRows(desk, chain).map((coin) => {
              const r = coin.research;
              return (
                <button
                  key={coin.token.mint}
                  onClick={() => r && onOpen(r)}
                  className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl px-2 py-2 text-left hover:bg-[var(--accent-wash)]"
                >
                  <span className="min-w-0">
                    {tapeLabel(coin.token.symbol)} <span className="text-[var(--muted)]">{r?.sector ?? coin.token.sector}</span>
                    {r?.candidate.apyPct ? (
                      <span className="num text-[var(--faint)]"> {r.candidate.apyPct.toFixed(2)}% APY</span>
                    ) : null}
                    {r?.candidate.priceAgreement === "split" ? (
                      <span className="text-[var(--crimson)]"> split</span>
                    ) : null}
                    <span className="block text-[11px] text-[var(--faint)]">{coin.signal ? coin.signal.thesis : coin.blocked ?? coin.call}</span>
                  </span>
                  <span className="num shrink-0 text-[var(--magenta)]">{r ? r.researchScore.toFixed(1) : "—"}</span>
                </button>
              );
            })}
          </div>
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
  const walletCro = chain === "cronos" ? croHoldings(wallet) : null;
  const signedCloses = fills.filter((trade) => trade.action === "close" && trade.pnlUsd !== null);
  const wins = swaps ? signedCloses.filter((trade) => (trade.pnlUsd ?? 0) > 0).length : desk.portfolio.winCount;
  const losses = swaps ? signedCloses.filter((trade) => (trade.pnlUsd ?? 0) <= 0).length : desk.portfolio.lossCount;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-medium tracking-tight">History</h2>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-[var(--muted)]">
          Open tickets and closed fills for {copy.bookLabel}.
        </p>
      </div>
      <div className="neon p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <Label>{swaps ? (chain === "cronos" ? "LIVE WolfSwap book" : "LIVE Jupiter book") : "PAPER book"}</Label>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {swaps
                ? copy.bookArm
                : chain === "cronos"
                  ? "PAPER is on, so this book only simulates fills. Enable LIVE, type LIVE this session, then arm. The trading key sends WolfSwap or cro.trade swaps."
                  : "PAPER is on, so this book only simulates fills. Enable LIVE, type LIVE this session, then arm. The trading key sends Jupiter swaps."}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto">
            {swaps ? (
              <button disabled={busy || profit < 1} onClick={onWithdraw} className="btn btn-magenta w-full sm:w-auto">
                {profit >= 1 ? `Send ${usd(profit)} profit to my wallet` : "Send profits to my wallet"}
              </button>
            ) : null}
            <button disabled={busy} onClick={() => onWalletSwaps(!swaps)} className="btn btn-ink w-full sm:w-auto">
              {swaps ? "Back to PAPER" : "Enable LIVE…"}
            </button>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label={swaps ? "Signed tickets" : "Sim book"} value={swaps ? String(fills.length) : usd(desk.portfolio.equityUsd)} sub={<Spark values={equitySeries} />} />
        <Stat
          label={trading ? "Trading balance" : "Wallet mark"}
          value={
            trading
              ? usd(trading.equityUsd)
              : walletCro
                ? formatCroEvm(walletCro.cro)
                : usd(wallet.equityUsd)
          }
          sub={
            trading
              ? `${trading.sol.toFixed(3)} CRO EVM · ${trading.usdc.toFixed(2)} USDC · profit ${usd(profit)} · ${shortAddress(trading.address)}`
              : walletCro
                ? walletCro.onPos
                  ? `${formatCro(walletCro.pos)} on Cronos POS`
                  : `${walletCro.usd > 0 ? usd(walletCro.usd) : "Price pending"} · ${wallet.usdc.toFixed(2)} USDC`
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
      <div className="neon p-4">
        <Label>History</Label>
        <div className="mt-3">
          <ExecutionLog trades={fills} positions={open} chain={chain} empty={swaps ? "No real buys yet." : "No buys yet."} />
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
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          onKeyDown={(event) => {
            if (event.code === "Space" || event.key === "Enter" || event.key.toLowerCase() === "f") {
              event.stopPropagation();
            }
          }}
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
          onClick={(event) => {
            event.stopPropagation();
            onExit();
          }}
          onKeyDown={(event) => {
            if (event.code === "Space" || event.key === "Enter" || event.key.toLowerCase() === "f") {
              event.stopPropagation();
            }
          }}
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
