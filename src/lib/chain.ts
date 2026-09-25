export type ChainId = "solana" | "cronos";

export const CHAIN_IDS: ChainId[] = ["solana", "cronos"];

export interface ChainCopy {
  id: ChainId;
  kicker: string;
  native: string;
  bookLabel: string;
  walletBook: string;
  swapHint: string;
  connectBlurb: string;
  connectFallback: string;
  installHint: string;
  armBlurb: string;
  watchBlurb: string;
  watchError: string;
  needWallet: string;
  needFunds: string;
  scanning: string;
  waitingTick: string;
  radar: string;
  noSwaps: string;
  bookArm: string;
  noOpen: string;
  noTickets: string;
  explorerName: string;
  settingsWallet: string;
  settingsMultiplier: string;
  settingsFive: string;
  settingsTen: string;
  settingsReset: string;
}

export const CHAIN_COPY: Record<ChainId, ChainCopy> = {
  solana: {
    id: "solana",
    kicker: "Solana",
    native: "SOL",
    bookLabel: "SOL and Zebec",
    walletBook: "SOL + USDC",
    swapHint: "Jupiter from the trading key",
    connectBlurb:
      "No demo book. No fallback equity. Phantom or Solflare must approve this origin, then the desk reads your real SOL and USDC and sizes the book from that. A $3 wallet is enough to open.",
    connectFallback: "Connect Solana wallet",
    installHint: "On a phone, Connect opens Phantom. Unlock it and approve the connection. This browser then opens the desk. On a computer, install Phantom or Solflare, then reload.",
    armBlurb:
      "Arm signs once. That signature moves spare SOL and USDC onto a trading key in this browser, and that key sends each swap. Tickets list only those signed fills.",
    watchBlurb: "Paste a Solana address. This page shows that wallet's live SOL and USDC, plus signed swaps stored in this browser.",
    watchError: "That is not a Solana address.",
    needWallet: "Connect a Solana wallet to trade.",
    needFunds: "priced SOL/USDC",
    scanning: "Scanning Solana",
    waitingTick: "Waiting for the first SOL and Zebec tick.",
    radar: "SOL and Zebec only. Empty rows mean the feeds missed this cycle — nothing is invented.",
    noSwaps:
      "No signed swaps yet. An armed bot sends the next rising SOL or Zebec long from the trading key. The row appears here with a Solscan link once that swap confirms.",
    bookArm:
      "Arm asks Phantom or Solflare to sign once. That transaction moves a trading balance to a key in this browser, and that key signs each Jupiter swap. Tickets list only those signed fills. Send profits returns cash above that deposit to your wallet and leaves the rest trading. Disarm sells open tickets, then sends the leftover SOL and USDC back.",
    noOpen: "No open swap. A rising SOL or Zebec long is sent from the trading key.",
    noTickets: "No live tickets yet. A swap from the trading key shows up here with a Solscan link. A red 15m tape stays in cash.",
    explorerName: "Solscan",
    settingsWallet:
      "On: The first arm signs one transaction and moves spare SOL and USDC to a browser trading key. That key signs each Jupiter swap. A refresh, or arming again while that key still holds a balance, does not move more. Disarm sells open tickets, then returns leftover SOL and USDC. Off leaves every fill in this browser. Shorts are not sent on-chain.",
    settingsMultiplier:
      "SOL and Zebec can open at 5x or 10x once the trading key has $10. SOL is a Jupiter perpetual. Zebec posts that collateral as a spot bag and the ticket is marked at the multiplier, because Jupiter has no ZBCN perp. Below $10 the same signal stays a spot buy. A stronger signal uses 10x when both are on. Shorts stay off-chain.",
    settingsFive: "Posts at least $10 and takes five times that exposure on SOL or Zebec.",
    settingsTen:
      "Used for SOL or Zebec when the signal is a breakout or confidence is 72 or higher. Ten times the collateral, so a smaller adverse move liquidates it.",
    settingsReset: "Reset wallet book is the control that clears the paper account back to the live SOL and USDC mark.",
  },
  cronos: {
    id: "cronos",
    kicker: "Cronos",
    native: "CRO",
    bookLabel: "CRO",
    walletBook: "CRO + USDC",
    swapHint: "VVS Finance router",
    connectBlurb:
      "No demo book. No fallback equity. MetaMask or the Crypto.com DeFi wallet must approve this origin and switch to Cronos, then the desk reads your real CRO and USDC and sizes the book from that. A CRO buy spends USDC on the VVS Finance router. A sell sends CRO back to USDC on that same router. A $3 wallet is enough to open.",
    connectFallback: "Connect Cronos wallet",
    installHint: "Install MetaMask or the Crypto.com DeFi wallet, then reload this page.",
    armBlurb:
      "Arm signs the funding transfer. That signature moves spare CRO and USDC onto a trading key in this browser, and that key sends each VVS swap. Tickets list only those signed fills.",
    watchBlurb: "Paste a Cronos address. This page shows that wallet's live CRO and USDC, plus signed swaps stored in this browser.",
    watchError: "That is not a Cronos address.",
    needWallet: "Connect a Cronos wallet to trade.",
    needFunds: "priced CRO/USDC",
    scanning: "Scanning Cronos",
    waitingTick: "Waiting for the first CRO tick.",
    radar: "CRO only. Empty rows mean the feeds missed this cycle — nothing is invented.",
    noSwaps:
      "No signed swaps yet. An armed bot sends the next rising CRO long from the trading key. The row appears here with a Cronoscan link once that swap confirms.",
    bookArm:
      "Arm asks the Cronos wallet to sign the funding transfer. That transaction moves a trading balance to a key in this browser, and that key signs each VVS swap. Tickets list only those signed fills. Send profits returns cash above that deposit to your wallet and leaves the rest trading. Disarm sells open tickets, then sends the leftover CRO and USDC back.",
    noOpen: "No open swap. A rising CRO long is sent from the trading key.",
    noTickets: "No live tickets yet. A swap from the trading key shows up here with a Cronoscan link. A red 15m tape stays in cash.",
    explorerName: "Cronoscan",
    settingsWallet:
      "On: The first arm signs one transaction and moves spare CRO and USDC to a browser trading key. That key signs each VVS swap. A refresh, or arming again while that key still holds a balance, does not move more. Disarm sells open tickets, then returns leftover CRO and USDC. Off leaves every fill in this browser. Shorts are not sent on-chain.",
    settingsMultiplier:
      "CRO can open at 5x or 10x once the trading key has $10. There is no CRO perp on this desk, so that collateral is a CRO spot bag and the ticket is marked at the multiplier. Below $10 the same signal stays a spot buy. A stronger signal uses 10x when both are on. Shorts stay off-chain.",
    settingsFive: "Posts at least $10 and takes five times that exposure on CRO.",
    settingsTen:
      "Used for CRO when the signal is a breakout or confidence is 72 or higher. Ten times the collateral, so a smaller adverse move liquidates it.",
    settingsReset: "Reset wallet book is the control that clears the paper account back to the live CRO and USDC mark.",
  },
};

export function sameMint(a: string, b: string): boolean {
  if (a.startsWith("0x") || a.startsWith("0X") || b.startsWith("0x") || b.startsWith("0X")) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

export function txUrl(chain: ChainId, signature: string): string {
  if (chain === "cronos") return `https://cronoscan.com/tx/${signature}`;
  return `https://solscan.io/tx/${signature}`;
}

export function tapeLabel(symbol: string): string {
  if (symbol === "ZBCN") return "Zebec";
  return symbol;
}
