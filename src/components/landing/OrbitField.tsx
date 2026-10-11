"use client";

import { landingMark, landingOrbit, type LandingToken } from "@/lib/landing";
import { useEffect, useMemo, useRef, useState } from "react";
import { MachineMark } from "./MachineMark";

const SLICES = 32;

function CoinFace({ token, src, failed, onError }: { token: LandingToken; src: string | null; failed: boolean; onError: () => void }) {
  if (!src || failed) {
    return <span className="coin-fallback">{token.symbol.slice(0, 3)}</span>;
  }
  return (
    // Local marks shipped in /public. next/image cannot frame a spinning coin.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" draggable={false} onError={onError} />
  );
}

function Coin({ token, index, count }: { token: LandingToken; index: number; count: number }) {
  const src = landingMark(token.symbol);
  const [failed, setFailed] = useState(false);
  const angle = (index / count) * 360;
  return (
    <div className="orbit-slot" style={{ transform: `rotateY(${angle}deg) translateZ(var(--radius))` }}>
      <div className="coin-stand">
      <div
        className="coin"
        style={{
          animationDuration: `${15 + (index % 5) * 2.6}s`,
          animationDelay: `${-index * 1.15}s`,
          animationDirection: index % 2 ? "reverse" : "normal",
        }}
      >
        <div className="coin-face coin-front">
          <CoinFace token={token} src={src} failed={failed} onError={() => setFailed(true)} />
        </div>
        <div className="coin-face coin-back">
          <CoinFace token={token} src={src} failed={failed} onError={() => setFailed(true)} />
        </div>
        {Array.from({ length: SLICES }, (_, slice) => (
          <i key={slice} className="coin-rim" style={{ ["--i" as string]: String(slice) }} />
        ))}
      </div>
      </div>
    </div>
  );
}

export function OrbitField() {
  const tokens = useMemo(() => landingOrbit(), []);
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const symbolRef = useRef<HTMLSpanElement>(null);
  const metaRef = useRef<HTMLSpanElement>(null);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const stage = stageRef.current;
    const world = worldRef.current;
    const ring = ringRef.current;
    if (!stage || !world || !ring) return;

    const fit = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      const coin = Math.round(Math.max(92, Math.min(188, Math.min(w, h) * 0.24)));
      const radius = Math.round(Math.max(coin * 1.85, Math.min(w * 0.38, h * 0.42, 440)));
      stage.style.setProperty("--coin", `${coin}px`);
      stage.style.setProperty("--thick", `${Math.max(11, Math.round(coin * 0.1))}px`);
      stage.style.setProperty("--radius", `${radius}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(pointer: fine)").matches;
    const onMove = (event: PointerEvent) => {
      const box = stage.getBoundingClientRect();
      pointer.current.x = (event.clientX - box.left) / box.width - 0.5;
      pointer.current.y = (event.clientY - box.top) / box.height - 0.5;
    };
    if (fine && !reduce) stage.addEventListener("pointermove", onMove);

    let frame = 0;
    let last = -1;
    const started = performance.now();
    const speed = reduce ? 0 : 11;
    const tick = (now: number) => {
      if (document.visibilityState === "hidden") {
        frame = requestAnimationFrame(tick);
        return;
      }
      const orbit = ((now - started) / 1000) * speed;
      const px = pointer.current.x * 10;
      const py = pointer.current.y * 6;
      const tiltX = 14 + py;
      const tiltY = -22 + px;
      world.style.transform = `rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
      const machine = stage.querySelector<HTMLElement>(".machine");
      if (machine) machine.style.transform = `rotateY(${-tiltY}deg) rotateX(${-tiltX}deg)`;
      ring.style.transform = `rotateX(58deg) rotateY(${orbit}deg)`;
      const step = 360 / tokens.length;
      const front = Math.round((((-orbit % 360) + 360) % 360) / step) % tokens.length;
      if (front !== last) {
        last = front;
        const token = tokens[front];
        if (symbolRef.current) symbolRef.current.textContent = token?.symbol ?? "";
        if (metaRef.current) {
          const chain = token?.chain === "cronos" ? "Cronos" : "Solana";
          metaRef.current.textContent = token ? `${chain} · ${token.sector}` : "";
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      stage.removeEventListener("pointermove", onMove);
    };
  }, [tokens]);

  return (
    <div className="orbit-wrap">
      <div className="stage" ref={stageRef}>
        <div className="world" ref={worldRef}>
          <div className="ground" />
          <div className="core-glow" />
          <MachineMark />
          <div className="ring" ref={ringRef}>
            <div className="rail" />
            {tokens.map((token, index) => (
              <Coin key={token.mint} token={token} index={index} count={tokens.length} />
            ))}
          </div>
        </div>
        <div className="laser" />
      </div>
      <div className="hud">
        <span className="hud-kicker">In front</span>
        <span className="hud-symbol" ref={symbolRef}>
          {tokens[0]?.symbol}
        </span>
        <span className="hud-meta" ref={metaRef}>
          {tokens[0] ? `${tokens[0].chain === "cronos" ? "Cronos" : "Solana"} · ${tokens[0].sector}` : ""}
        </span>
      </div>
      <p className="sr-only">
        Traded names spinning in a ring: {tokens.map((token) => token.symbol).join(", ")}.
      </p>
    </div>
  );
}
