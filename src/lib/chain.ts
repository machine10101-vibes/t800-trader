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
    bookLabel: "SOL, Zebec, Pump, ZEC, and Ray",
    walletBook: "SOL + USDC",
    swapHint: "Jupiter from the trading key",
    connectBlurb:
      "Connect Phantom or Solflare and the desk reads your SOL and USDC. It starts in practice mode, so no money moves until you turn on real money. $3 is enough to start.",
    connectFallback: "Connect Solana wallet",
    installHint: "On a phone, Connect opens Phantom. Unlock it and approve the connection. This browser then opens the desk. On a computer, install Phantom or Solflare, then reload.",
    armBlurb:
      "In real-money mode, turning the bot on asks your wallet to approve one transfer to a trading key kept in this browser. That key places each trade, and turning the bot off sends the money back.",
    watchBlurb: "Paste any Solana address to see its SOL and USDC and the trades this browser saved for it. Nothing can be traded from here.",
    watchError: "That is not a Solana address.",
    needWallet: "Connect a Solana wallet to trade.",
    needFunds: "priced SOL/USDC",
    scanning: "Scanning Solana",
    waitingTick: "Waiting for the first SOL, Zebec, Pump, ZEC, and Ray tick.",
    radar: "SOL, Zebec, Pump, ZEC, and Ray. Empty rows mean the feeds missed this cycle — nothing is invented.",
    noSwaps:
      "No signed swaps yet. An armed bot sends the next rising SOL, Zebec, Pump, ZEC, or Ray long from the trading key. The row appears here with a Solscan link once that swap confirms.",
    bookArm:
      "Arm asks Phantom or Solflare to sign once. That transaction moves a trading balance to a key in this browser, and that key signs each Jupiter swap. Tickets list only those signed fills. Send profits returns cash above that deposit to your wallet and leaves the rest trading. Disarm sells open tickets, then sends the leftover SOL and USDC back.",
    noOpen: "No open swap. A rising SOL, Zebec, Pump, ZEC, or Ray long is sent from the trading key.",
    noTickets: "No live tickets yet. A swap from the trading key shows up here with a Solscan link. The bot trades a 15-minute setup once the 1-hour and 4-hour charts agree, so a quiet day can pass with no trade.",
    explorerName: "Solscan",
    settingsWallet:
      "On: The first arm signs one transaction and moves spare SOL and USDC to a browser trading key. That key signs each Jupiter swap. A refresh, or arming again while that key still holds a balance, does not move more. Disarm sells open tickets, then returns leftover SOL and USDC. Off leaves every fill in this browser. A SOL short is a Jupiter perpetual. Other tokens cannot be shorted on-chain.",
    settingsMultiplier:
      "Pick spot swaps, SOL margin, or both. 5x and 10x are SOL only, long or short, from a $5 order. Jupiter will not open a brand-new position under $10, so a $5 order is raised to $10 when the trading key has it. Zebec, Pump, ZEC, and Ray stay a spot buy and a spot sell unless you pick margin only, which skips them. Turn on Margin only on solid 4-hour setups to wait for a 4-hour structure before a SOL perp.",
    settingsFive: "SOL only. Posts at least $5 and takes five times that exposure.",
    settingsTen: "SOL only. Puts up at least $5 and takes ten times that much. An even smaller drop can wipe it out.",
    settingsReset: "Reset wallet book is the control that clears the paper account back to the live SOL and USDC mark.",
  },
  cronos: {
    id: "cronos",
    kicker: "Cronos",
    native: "CRO",
    bookLabel: "CRO, ULTCAT, CRIMECAT, MERY, PACK, and ULTI",
    walletBook: "CRO + USDC",
    swapHint: "WolfSwap and cro.trade",
    connectBlurb:
      "No demo book. No fallback equity. The Crypto.com Onchain extension approves this origin and switches to Cronos, then the desk reads your real CRO and USDC and sizes the book from that. A buy spends USDC. WolfSwap and cro.trade are both quoted, and the better one is sent. About 3 CRO on Cronos EVM is enough to arm.",
    connectFallback: "Connect Cronos wallet",
    installHint: "Install the Crypto.com Onchain extension, then reload this page.",
    armBlurb:
      "Arm asks the Crypto.com Onchain extension to sign. The first signature moves spare CRO and USDC onto a trading key in this browser, and that key sends each swap. If that key already holds the balance, the extension still signs and no more CRO is moved.",
    watchBlurb: "Paste a Cronos address. This page shows that wallet's live CRO and USDC, plus signed swaps stored in this browser.",
    watchError: "That is not a Cronos address.",
    needWallet: "Connect a Cronos wallet to trade.",
    needFunds: "priced CRO/USDC",
    scanning: "Scanning Cronos",
    waitingTick: "Waiting for the first CRO, ULTCAT, CRIMECAT, MERY, PACK, and ULTI tick.",
    radar: "CRO, ULTCAT, CRIMECAT, MERY, PACK, and ULTI. Empty rows mean the feeds missed this cycle — nothing is invented.",
    noSwaps:
      "No signed swaps yet. An armed bot sends the next 15-minute setup that passes the 1-hour and 4-hour check from the trading key. The row appears here with a Cronoscan link once that swap confirms.",
    bookArm:
      "Arm asks the Crypto.com Onchain extension to sign. That signature moves a trading balance to a key in this browser, and that key signs each WolfSwap or cro.trade swap. Tickets list only those signed fills. Send profits returns cash above that deposit to your wallet and leaves the rest trading. Disarm asks the extension to sign, sells open tickets, then sends the leftover CRO and USDC back.",
    noOpen: "No open swap. A 15-minute setup that passes the 1-hour and 4-hour check is sent from the trading key.",
    noTickets:
      "No live tickets yet. A swap from the trading key shows up here with a Cronoscan link. The bot trades a 15-minute setup once the 1-hour and 4-hour charts agree, so a quiet day can pass with no trade. Practice can bet against these coins. Real money only buys and sells.",
    explorerName: "Cronoscan",
    settingsWallet:
      "On: Arm asks the Crypto.com Onchain extension to sign and moves spare CRO and USDC to a browser trading key. That key quotes WolfSwap and cro.trade and sends the better swap. Arming again while that key still holds a balance asks for a signature and does not move more CRO. Disarm asks the extension to sign, sells open tickets, then returns leftover CRO and USDC. Off leaves every fill in this browser. Real-money shorts are not sent.",
    settingsMultiplier: "Every Cronos ticket is a normal buy and a normal sell. Extra size is not used.",
    settingsFive: "Does not apply. Cronos tickets stay a spot buy and a spot sell.",
    settingsTen: "Does not apply. Cronos tickets stay a spot buy and a spot sell.",
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

const DESK_CHAIN_KEY = "t800-trader-desk-chain";

export function readDeskChain(): ChainId {
  if (typeof window === "undefined") return "solana";
  try {
    const raw = window.localStorage.getItem(DESK_CHAIN_KEY);
    if (raw === "cronos" || raw === "solana") return raw;
  } catch {
    // Private mode still opens Solana first.
  }
  return "solana";
}

export function writeDeskChain(chain: ChainId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DESK_CHAIN_KEY, chain);
  } catch {
    // The in-memory desk still switches.
  }
}
