"use client";

import Link from "next/link";
import { landingMark, landingTokens } from "@/lib/landing";
import { OrbitField } from "./OrbitField";
import "./landing.css";

const RULES = [
  {
    kicker: "01",
    title: "Fifteen-minute entry",
    body: "The shortest chart you leave on has to set up. The default is the 15-minute.",
  },
  {
    kicker: "02",
    title: "Higher frames agree",
    body: "The 1-hour and 4-hour back-check the entry. Neither points the other way. At least one agrees.",
  },
  {
    kicker: "03",
    title: "Buy, then sell",
    body: "Every ticket is a buy and a later sell. The stop and the target lock in when it opens.",
  },
];

export function Landing() {
  const tokens = landingTokens();
  const solana = tokens.filter((token) => token.chain === "solana");
  const cronos = tokens.filter((token) => token.chain === "cronos");

  return (
    <div className="landing">
      <div className="landing-vignette" />
      <header className="landing-nav">
        <Link href="/" className="brand">
          <span className="brand-eye" />
          <span>
            <strong>T-800</strong>
            <small>Trader</small>
          </span>
        </Link>
        <nav className="landing-links">
          <a href="#book">The book</a>
          <a href="#rules">How it trades</a>
        </nav>
        <Link href="/desk" className="nav-enter">
          Enter desk
        </Link>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="pulse" /> Model T-800 · Solana and Cronos
          </p>
          <h1 className="display">
            Both chains.
            <br />
            One machine.
          </h1>
          <p className="lede">
            The coins in the ring are the names this desk trades. Practice money is the default. Live spends only after you arm.
          </p>
          <div className="hero-actions">
            <Link href="/desk" className="enter">
              Enter the desk
              <span aria-hidden>→</span>
            </Link>
            <a href="#book" className="ghost">
              See the book
            </a>
          </div>
          <dl className="stats">
            <div>
              <dt>Solana</dt>
              <dd>{solana.length} names</dd>
            </div>
            <div>
              <dt>Cronos</dt>
              <dd>{cronos.length} names</dd>
            </div>
            <div>
              <dt>Default</dt>
              <dd>Practice</dd>
            </div>
          </dl>
        </div>
        <OrbitField />
      </section>

      <section id="book" className="band">
        <div className="band-head">
          <p className="eyebrow">The book</p>
          <h2 className="display">Marks it can actually buy.</h2>
        </div>
        <div className="books">
          <Book title="Solana" note="Jupiter" tokens={solana} />
          <Book title="Cronos" note="WolfSwap · VVS · cro.trade" tokens={cronos} />
        </div>
      </section>

      <section id="rules" className="band rules">
        <div className="band-head">
          <p className="eyebrow">How a ticket opens</p>
          <h2 className="display">It waits for the charts to agree.</h2>
        </div>
        <div className="rule-grid">
          {RULES.map((rule) => (
            <article key={rule.kicker} className="rule">
              <span>{rule.kicker}</span>
              <h3>{rule.title}</h3>
              <p>{rule.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="close">
        <h2 className="display">Step into the desk.</h2>
        <p>Practice stays on until you turn live money on and arm.</p>
        <Link href="/desk" className="enter">
          Enter the desk
          <span aria-hidden>→</span>
        </Link>
      </section>

      <footer className="landing-foot">
        <span>T-800 Trader</span>
        <span>Buys and sells · Paper first</span>
      </footer>
    </div>
  );
}

function Book({
  title,
  note,
  tokens,
}: {
  title: string;
  note: string;
  tokens: ReturnType<typeof landingTokens>;
}) {
  return (
    <div className="book">
      <header>
        <h3>{title}</h3>
        <p>{note}</p>
      </header>
      <ul>
        {tokens.map((token) => {
          const src = landingMark(token.symbol);
          return (
            <li key={token.mint}>
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" width={56} height={56} />
              ) : (
                <span className="coin-fallback">{token.symbol.slice(0, 2)}</span>
              )}
              <span>
                <strong>{token.symbol}</strong>
                <em>{token.name}</em>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
