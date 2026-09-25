"use client";

import { CandleChart, EquityPath, ScatterTape, VolumeBars } from "@/components/desk/charts";
import { SettingsPanel } from "@/components/desk/settings";
import { WatchScreen } from "@/components/desk/watch";
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
import { venueForDex, venueLabel } from "@/lib/market/venues";
import {
  connectWallet,
  detectedWalletName,
  disconnectWallet,
  listenWallet,
  refreshWallet,
  type WalletSession,
} from "@/lib/solana/wallet";
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
  const [tab, setTab] = useState<Tab>("overview");
  const [wallet, setWallet] = useState<WalletSession | null>(null);
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
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const [watchAddress, setWatchAddress] = useState<string | null>(null);
  const [watchDraft, setWatchDraft] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);
  const [knownBooks, setKnownBooks] = useState<string[]>([]);
  const lastTradeId = useRef<string | null>(null);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const busyRef = useRef(false);
  const armEnsure = useRef<string | null>(null);

  const openWatch = useCallback((raw: string) => {
    const parsed = parseWalletAddress(raw);
    if (!parsed) {
      setWatchError("That is not a Solana address.");
      return;
    }
    setWatchError(null);
    setWatchAddress(parsed);
    const url = new URL(window.location.href);
    url.searchParams.set("watch", parsed);
    window.history.replaceState(null, "", url);
  }, []);

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
      applyDesk(await loadDesk());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Desk refresh failed");
    } finally {
      setBooting(false);
    }
  }, [applyDesk, wallet]);

  const connect = useCallback(async (trusted = false) => {
    setWalletBusy(true);
    setWalletError(null);
    try {
      const session = await connectWallet(trusted);
      const book = await attachWallet(session.address, session.equityUsd);
      applyDesk(shellDesk(book));
      setWallet(session);
      setBooting(false);
    } catch (e) {
      if (!trusted) setWalletError(e instanceof Error ? e.message : "Wallet connect failed");
    } finally {
      setWalletBusy(false);
    }
  }, [applyDesk]);

  const disconnect = useCallback(async () => {
    await disconnectWallet(wallet?.provider);
    detachWallet();
    setWallet(null);
    setTrading(null);
    setDesk(null);
    setThesis(null);
    setError(null);
    setBooting(false);
  }, [wallet]);

  useEffect(() => {
    setWalletHint(detectedWalletName());
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("watch");
    if (query && parseWalletAddress(query)) return;
    void connect(true);
  }, [connect]);

  useEffect(() => {
    if (!wallet) return;
    return listenWallet(wallet.provider, {
      onDisconnect: () => {
        detachWallet();
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
          detachWallet();
          const session = await refreshWallet({ ...wallet, address });
          const book = await attachWallet(session.address, session.equityUsd);
          applyDesk(shellDesk(book));
          setWallet(session);
          setBooting(false);
        })();
      },
    });
  }, [applyDesk, disconnect, wallet]);

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
      void tradingSnapshot(wallet.address)
        .then(async (snap) => {
          if (!live) return;
          setTrading(snap);
          if (!snap) return;
          const wrote = await baselineTradingPrincipal(snap.equityUsd);
          if (wrote && live) applyDesk(await loadDesk());
        })
        .catch(() => undefined);
    };
    pullTrading();
    const id = setInterval(() => {
      void refreshWallet(wallet)
        .then(async (session) => {
          setWallet(session);
          await attachWallet(session.address, session.equityUsd);
          pullTrading();
        })
        .catch(() => undefined);
    }, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [applyDesk, wallet]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("watch");
    if (query) {
      const parsed = parseWalletAddress(query);
      if (parsed) setWatchAddress(parsed);
    }
    setKnownBooks(listLocalBooks());
  }, []);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!walletRef.current) return;
    const seconds = Math.max(6, desk?.config.scanSeconds ?? 8);
    let cancel = false;
    let inflight = false;
    const run = async () => {
      const current = walletRef.current;
      if (!current || cancel || inflight || busyRef.current) return false;
      inflight = true;
      try {
        const next = await controlBot("tick", current);
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
    const id = window.setInterval(() => void run(), seconds * 1000);
    return () => {
      cancel = true;
      window.clearInterval(first);
      window.clearInterval(id);
    };
  }, [applyDesk, desk?.config.scanSeconds, wallet?.address]);

  useEffect(() => {
    const session = walletRef.current;
    if (!session || !desk?.bot.running || !desk.config.walletSwaps) return;
    if (trading && trading.equityUsd >= MIN_TRADE_USD) {
      armEnsure.current = session.address;
      return;
    }
    if (armEnsure.current === session.address) return;
    armEnsure.current = session.address;
    let cancel = false;
    void (async () => {
      try {
        const fresh = await refreshWallet(session);
        if (cancel) return;
        setWallet(fresh);
        const next = await controlBot("start", fresh);
        if (cancel) return;
        applyDesk(next);
        setTrading(await tradingSnapshot(fresh.address).catch(() => null));
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : "Arm signature failed");
      }
    })();
    return () => {
      cancel = true;
    };
  }, [applyDesk, desk?.bot.running, desk?.config.walletSwaps, trading, wallet?.address]);

  useEffect(() => {
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
  }, [desk?.bot.running, wallet, refresh]);

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
      setError("Connect a Solana wallet to trade.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    if (action === "start") armEnsure.current = wallet.address;
    try {
      if (action === "start" || action === "reset") {
        const session = await refreshWallet(wallet);
        setWallet(session);
        if (action === "start" && session.equityUsd < MIN_TRADE_USD) {
          const funded = await tradingSnapshot(session.address);
          if (!funded || funded.equityUsd < MIN_TRADE_USD) {
            setError(`Wallet needs at least $${MIN_TRADE_USD} of priced SOL/USDC to trade.`);
            return;
          }
        }
        if (action === "start") await attachWallet(session.address, Math.max(session.equityUsd, trading?.equityUsd ?? 0));
        applyDesk(await controlBot(action, session));
        setTrading(await tradingSnapshot(session.address).catch(() => null));
        if (action === "reset") {
          await adoptLiveEquity(session.equityUsd);
          const next = await loadDesk();
          applyDesk(next);
          if (next.portfolio.equityUsd < MIN_TRADE_USD) {
            setError(`Wallet needs at least $${MIN_TRADE_USD} of priced SOL/USDC to trade.`);
          }
        }
        return;
      }
      applyDesk(await controlBot(action, wallet));
      setTrading(await tradingSnapshot(wallet.address).catch(() => null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Control failed");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const withdrawProfit = async () => {
    if (!wallet) {
      setError("Connect a Solana wallet to trade.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      applyDesk(await withdrawTradingProfit(wallet));
      const [session, snap] = await Promise.all([
        refreshWallet(wallet),
        tradingSnapshot(wallet.address).catch(() => null),
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
      applyDesk(await configureBot(config));
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
      applyDesk(await closeTicket(positionId, wallet));
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
      applyDesk(await cancelResting(wallet));
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
  const solRow = desk?.research.find((r) => r.ticker === "SOL");
  const solPx = desk?.regime.sol.price || solRow?.price || wallet?.solPriceUsd || 0;
  const solChg = desk?.regime.sol.price ? desk.regime.sol.change24h : solRow?.candidate.flows.h24.priceChangePct;

  if (watchAddress) {
    return <WatchScreen address={watchAddress} onClose={closeWatch} />;
  }

  if (!wallet) {
    return (
      <div className="min-h-screen overflow-y-auto px-6 py-10">
        <div className="mx-auto w-full max-w-xl">
        <div className="neon boot-fade w-full max-w-xl p-8 sm:p-10">
          <div className="orb mb-6 grid place-items-center text-lg font-semibold text-black">T8</div>
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--magenta)]">T-800 // Solana</div>
          <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">Connect a wallet to arm the desk</h1>
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            No demo book. No fallback equity. Phantom or Solflare must approve this origin, then the desk reads your real
            SOL and USDC and sizes the book from that. A $3 wallet is enough to open.
          </p>
          <div className="mt-5 grid gap-2 text-sm text-[var(--muted)] sm:grid-cols-3">
            <GateChip label="Live marks" hint="CoinGecko · GeckoTerminal" />
            <GateChip label="Wallet book" hint="SOL + USDC only" />
            <GateChip label="Live swaps" hint="Jupiter from the trading key" />
          </div>
          {walletError ? <p className="mt-4 text-sm text-[var(--crimson)]">{walletError}</p> : null}
          <button disabled={walletBusy} onClick={() => void connect(false)} className="btn btn-magenta mt-6 w-full">
            {walletBusy ? "Waiting on wallet…" : walletHint ? `Connect ${walletHint}` : "Connect Solana wallet"}
          </button>
          <form
            className="mt-6 border-t border-[var(--line)] pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              openWatch(watchDraft);
            }}
          >
            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--faint)]">Watch a book</div>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Paste a Solana address. This page shows that wallet&apos;s live SOL and USDC, plus signed swaps stored in this browser.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={watchDraft}
                onChange={(event) => setWatchDraft(event.target.value)}
                placeholder="Wallet address"
                spellCheck={false}
                className="num w-full rounded-xl border border-[var(--line)] bg-black/30 px-3 py-3 text-sm outline-none"
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
            {walletHint ? `${walletHint} is injected in this browser.` : "Install Phantom or Solflare, then reload this page."}{" "}
            Arm signs once. That signature moves spare SOL and USDC onto a trading key in this browser, and that key sends each swap. Tickets list only those signed fills.
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
    <div className="min-h-screen">
      <Header
        desk={desk}
        wallet={wallet}
        clock={clock}
        solPx={solPx}
        solChg={solChg}
        updatedAt={updatedAt}
        onDisconnect={() => void disconnect()}
        onRefresh={() => void refresh()}
        onWatch={() => openWatch(wallet.address)}
        trading={trading}
      />

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-5 px-4 py-5 lg:grid-cols-[228px_1fr]">
        <aside className="neon h-fit p-3 lg:sticky lg:top-20">
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
              className="nav-item mb-1 flex w-full items-center justify-between px-3 py-3 text-left hover:bg-[rgba(255,255,255,0.03)]"
            >
              <span>
                <span className="mr-2 text-[11px] text-[var(--faint)]">{item.kicker}</span>
                {item.label}
              </span>
              {item.id === "bot" && desk?.bot.running ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--mint)]" /> : null}
            </button>
          ))}
          <button
            disabled={busy || !desk}
            onClick={() => void control(desk?.bot.running ? "stop" : "start")}
            className={`btn mt-3 w-full ${
              desk?.bot.running ? "bg-[rgba(255,59,143,0.14)] text-[var(--crimson)]" : "btn-magenta"
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
          {desk?.bot.lastNote ? <p className="mt-3 px-2 text-[11px] leading-5 text-[var(--magenta)]">{desk.bot.lastNote}</p> : null}
          <p className="mt-2 px-2 text-[11px] leading-5 text-[var(--faint)]">
            {trading
              ? `${trading.sol.toFixed(3)} SOL · ${trading.usdc.toFixed(2)} USDC on the trading key ${shortAddress(trading.address)}. Arm signed once. That key sends the swaps.`
              : `${wallet.sol.toFixed(3)} SOL · ${wallet.usdc.toFixed(2)} USDC. ${
                  desk?.config.walletSwaps ? "Arm signs once. That signature sends the swaps." : "Fills stay in this browser."
                }`}
          </p>
          <button onClick={() => void disconnect()} className="mt-2 px-2 text-[11px] uppercase tracking-[0.16em] text-[var(--faint)] sm:hidden">
            Disconnect
          </button>
        </aside>

        <main className="min-w-0 space-y-5 pt-1">
          {error ? (
            <div className="rounded-[18px] border border-[rgba(255,59,143,0.3)] bg-[rgba(255,59,143,0.08)] px-4 py-3 text-sm text-[var(--crimson)]">
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
                  onFocus={setFocusMint}
                  onOpen={setThesis}
                  onArm={() => void control(armButton(desk.bot.running).action)}
                  busy={busy}
                />
              ) : null}
              {tab === "radar" ? <Radar desk={desk} onOpen={setThesis} /> : null}
              {tab === "bot" ? (
                <BotView
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
              {tab === "risk" ? <SettingsPanel desk={desk} busy={busy} onSave={saveConfig} onReset={() => void control("reset")} /> : null}
            </div>
          )}
          {desk ? (
            <div className="cmd">
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
    <div className="rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-3">
      <div className="text-xs font-medium text-[var(--text)]">{label}</div>
      <div className="mt-1 text-[11px] text-[var(--faint)]">{hint}</div>
    </div>
  );
}

function Header({
  desk,
  wallet,
  clock,
  solPx,
  solChg,
  updatedAt,
  onDisconnect,
  onRefresh,
  onWatch,
  trading,
}: {
  desk: DeskPayload | null;
  wallet: WalletSession;
  clock: string;
  solPx: number;
  solChg?: number;
  updatedAt: string | null;
  onDisconnect: () => void;
  onRefresh: () => void;
  onWatch: () => void;
  trading: { equityUsd: number } | null;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[rgba(5,5,8,0.82)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[rgba(255,74,216,0.12)] text-sm font-semibold text-[var(--magenta)]">
            T8
          </div>
          <div>
            <div className="text-sm font-medium">T-800 Trader</div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--faint)]">Live stream</div>
          </div>
        </div>
        <div className="hidden items-center gap-5 md:flex">
          <Ticker label="SOL" value={solPx ? priceFmt(solPx) : "—"} chg={solPx ? solChg : undefined} />
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
        <div className="ml-auto flex items-center gap-3 text-sm">
          <button onClick={onRefresh} className="hidden text-[11px] uppercase tracking-[0.16em] text-[var(--faint)] sm:block">
            Refresh
          </button>
          <button onClick={onWatch} className="hidden text-[11px] uppercase tracking-[0.16em] text-[var(--faint)] sm:block">
            Watch
          </button>
          <Pill tone="magenta">{shortAddress(wallet.address)}</Pill>
          <Pill tone={desk?.bot.running ? "mint" : "default"}>
            <span className={`pulse-dot ${desk?.bot.running ? "bg-[var(--mint)] text-[var(--mint)]" : "bg-[var(--faint)] text-[var(--faint)]"}`} />
            {desk?.bot.running ? "Armed" : "Standby"}
          </Pill>
          <div className="hidden text-right sm:block">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">{trading ? "Trading" : "Wallet"}</div>
            <div className="num">{usd(trading ? trading.equityUsd : wallet.equityUsd)}</div>
          </div>
          <button onClick={onDisconnect} className="hidden text-[11px] uppercase tracking-[0.16em] text-[var(--faint)] sm:block">
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

function useWatchTapes(tapes: TapeCard[]): Record<string, Candle[]> {
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
            const candles = await fetchOhlcv(poolAddress, 48);
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
    const id = setInterval(() => void pull(), 45_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [key]);
  return bars;
}

function Overview({
  desk,
  wallet,
  trading,
  winRate,
  focusMint,
  onFocus,
  onOpen,
  onArm,
  busy,
}: {
  desk: DeskPayload;
  wallet: WalletSession;
  trading: { equityUsd: number } | null;
  winRate: number;
  focusMint: string | null;
  onFocus: (mint: string) => void;
  onOpen: (t: ResearchThesis) => void;
  onArm: () => void;
  busy: boolean;
}) {
  const focus = desk.research.find((r) => r.candidate.mint === focusMint) ?? desk.research[0] ?? null;
  const bars = useWatchTapes(desk.tapes);
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
                    focus?.id === r.id ? "bg-[rgba(255,74,216,0.16)] text-[var(--magenta)]" : "text-[var(--faint)] hover:text-[var(--text)]"
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
            className={`btn mt-5 w-full ${desk.bot.running ? "bg-[rgba(255,59,143,0.14)] text-[var(--crimson)]" : "btn-magenta"}`}
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
        <div className="mb-3 flex items-center justify-between px-1">
          <Label>5-minute tapes</Label>
          <span className="text-[11px] text-[var(--faint)]">{desk.tapes.length ? "SOL · Zebec" : "Waiting on pools"}</span>
        </div>
        {desk.tapes.length === 0 ? (
          <p className="px-1 pb-2 text-sm text-[var(--muted)]">SOL and Zebec 5-minute charts load with the tape.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {desk.tapes.map((tape) => (
              <button
                key={tape.poolAddress}
                onClick={() => onFocus(tape.mint)}
                className={`rounded-2xl border p-2 text-left ${
                  focusTape?.poolAddress === tape.poolAddress ? "border-[var(--magenta)]" : "border-[var(--line)]"
                }`}
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-sm font-medium">{tape.symbol}</span>
                  <Tone value={tape.change15m} />
                </div>
                <div className="h-[132px]">
                  <CandleChart candles={bars[tape.poolAddress] ?? []} />
                </div>
              </button>
            ))}
          </div>
        )}
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
        <div className="mb-2 flex items-center justify-between px-2">
          <Label>Live tape</Label>
          <span className="text-[11px] text-[var(--faint)]">
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
                  ? "No signed swaps yet. An armed bot sends the next rising SOL or Zebec long from the trading key. The row appears here with a Solscan link once that swap confirms."
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
            <div className="desk-scroll max-h-56 space-y-2 overflow-y-auto font-mono text-[11px] text-[var(--muted)]">
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
                className="flex w-full items-center justify-between rounded-xl border border-[var(--line)] px-3 py-2 text-left hover:bg-[rgba(255,74,216,0.05)]"
              >
                <span>
                  {r.ticker} <span className="text-[var(--muted)]">{r.sector}</span>
                  {r.candidate.apyPct ? (
                    <span className="num text-[var(--faint)]"> {r.candidate.apyPct.toFixed(2)}% APY</span>
                  ) : null}
                </span>
                <span className="num text-[var(--magenta)]">{r.researchScore.toFixed(1)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Radar({ desk, onOpen }: { desk: DeskPayload; onOpen: (t: ResearchThesis) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-medium tracking-tight">Research radar</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
          SOL and Zebec only. Empty rows mean the feeds missed this cycle — nothing is invented.
        </p>
      </div>
      <div className="neon desk-scroll overflow-x-auto p-1">
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
                  className="cursor-pointer border-t border-[var(--line)] hover:bg-[rgba(255,74,216,0.04)]"
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
            <Pill tone={desk.bot.running ? "mint" : "magenta"}>{desk.bot.running ? "Scanning Solana" : "Idle"}</Pill>
            <h2 className="mt-3 text-3xl font-medium">Wallet-gated ticks. Time-boxed.</h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              {desk.bot.lastNote ??
                "One new ticket per tick. Breakouts must clear the prior high. Winners scale at 1R; stops move to breakeven at 0.8R."}
            </p>
          </div>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => onControl(desk.bot.running ? "stop" : "start")} className="btn btn-ink">
              {desk.bot.running ? "Disarm" : "Arm"}
            </button>
            <button disabled={busy} onClick={() => onControl("tick")} className="btn btn-ghost">
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
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">{edge.label}</span>
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
              className="rounded-lg border border-[rgba(255,59,74,0.4)] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--crimson)] disabled:opacity-60"
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
                ? "No open swap. This list refreshes on every scan, and a signed ticket shows up here with its Solscan link."
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
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      {s.symbol} <Pill tone={s.side === "long" ? "mint" : "crimson"}>{s.side}</Pill>
                    </div>
                    <span className="num text-[var(--magenta)]">{s.confidence.toFixed(0)}</span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">{s.thesis}</p>
                </div>
              ))}
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
                  className="flex w-full items-center justify-between rounded-xl px-2 py-2 hover:bg-[rgba(255,74,216,0.05)]"
                >
                  <span>
                    {r.ticker} <span className="text-[var(--muted)]">{r.sector}</span>
                    {r.candidate.apyPct ? (
                      <span className="num text-[var(--faint)]"> {r.candidate.apyPct.toFixed(2)}% APY</span>
                    ) : null}
                    {r.candidate.priceAgreement === "split" ? (
                      <span className="text-[var(--crimson)]"> split</span>
                    ) : null}
                  </span>
                  <span className="num text-[var(--magenta)]">{r.researchScore.toFixed(1)}</span>
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
  desk: DeskPayload;
  wallet: WalletSession;
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
                ? "Arm asks Phantom or Solflare to sign once. That transaction moves a trading balance to a key in this browser, and that key signs each Jupiter swap. Tickets list only those signed fills. Send profits returns cash above that deposit to your wallet and leaves the rest trading. Disarm sells open tickets, then sends the leftover SOL and USDC back."
                : "Wallet swaps are off, so this book only simulates fills. Turn them on, then arm, and the wallet signature is what sends the swaps."}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {swaps ? (
              <button disabled={busy || profit < 1} onClick={onWithdraw} className="btn btn-magenta">
                {profit >= 1 ? `Send ${usd(profit)} profit to my wallet` : "Send profits to my wallet"}
              </button>
            ) : null}
            <button disabled={busy} onClick={() => onWalletSwaps(!swaps)} className="btn btn-ink">
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
              ? `${trading.sol.toFixed(3)} SOL · ${trading.usdc.toFixed(2)} USDC · profit ${usd(profit)} · ${shortAddress(trading.address)}`
              : `${wallet.sol.toFixed(3)} SOL · ${wallet.usdc.toFixed(2)} USDC`
          }
        />
        <Stat label="Hit rate" value={`${winRate.toFixed(0)}%`} sub={`${wins}W / ${losses}L`} />
        <Stat label="Expectancy" value={usd(stats.expectancyUsd)} sub={`PF ${stats.profitFactor === null ? "—" : Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞"}`} />
      </div>
      <div className="neon overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-4">
          <Label>Open positions</Label>
          <button disabled={busy || open.length === 0} onClick={onFlatten} className="btn btn-ghost py-1.5 text-xs">
            Flatten book
          </button>
        </div>
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
                  {swaps ? "No open swap. A rising SOL or Zebec long is sent from the trading key." : "No open ticket."}
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
      <div className="neon overflow-x-auto">
        <div className="px-4 pt-4">
          <Label>Tickets</Label>
        </div>
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
                  {swaps
                    ? "No live tickets yet. A swap from the trading key shows up here with a Solscan link. A red 15m tape stays in cash."
                    : "No tickets."}
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
                  <td>{txLink(t.signature)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function txLink(signature?: string) {
  if (!signature) return <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">Simulated</span>;
  const short = signature.length > 10 ? `${signature.slice(0, 4)}…${signature.slice(-4)}` : signature;
  return (
    <a className="num text-[11px] text-[var(--mint)]" href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer">
      {short}
    </a>
  );
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
          className="rounded-lg border border-[rgba(255,59,74,0.45)] bg-[rgba(255,59,74,0.08)] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--crimson)] disabled:opacity-60"
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
        className="drawer-panel desk-scroll h-full w-full max-w-xl overflow-y-auto border-l border-[var(--line)] bg-[#09090f] p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Pill tone={position.side === "long" ? "mint" : "crimson"}>{sideText(position.side, position.leverage)}</Pill>
            <h3 className="mt-3 text-3xl font-medium">{position.symbol}</h3>
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
          className="btn mt-6 w-full bg-[rgba(255,59,74,0.14)] text-[var(--crimson)] disabled:opacity-60"
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
        className="drawer-panel desk-scroll h-full w-full max-w-xl overflow-y-auto border-l border-[var(--line)] bg-[#09090f] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Pill tone="magenta">{thesis.sector}</Pill>
            <h3 className="mt-3 text-3xl font-medium">
              {thesis.asset} <span className="text-[var(--muted)]">{thesis.ticker}</span>
            </h3>
            <div className="mt-2 flex gap-4 text-sm text-[var(--muted)]">
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
                <div className="flex items-center gap-2 text-sm">
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
