export type ChainId = "solana" | "cronos" | "dash";

export const CHAIN_IDS: ChainId[] = ["solana", "cronos", "dash"];

/** Cronos and Dash stay a spot buy and a spot sell. Solana can also use margin. */
export function isSpotDesk(chain: ChainId): boolean {
  return chain === "cronos" || chain === "dash";
}

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
      "In real-money mode, turning the bot on asks your wallet to approve a transfer of 0.05 SOL plus the armed USDC to a trading key kept in this browser. That key places each trade, and turning the bot off sends the money back.",
    watchBlurb: "Paste any Solana address to see its SOL and USDC and the trades this browser saved for it. Nothing can be traded from here.",
    watchError: "That is not a Solana address.",
    needWallet: "Connect a Solana wallet to trade.",
    needFunds: "priced SOL/USDC",
    scanning: "Scanning Solana",
    waitingTick: "Waiting for the first SOL, Zebec, Pump, ZEC, and Ray tick.",
    radar: "SOL, Zebec, Pump, ZEC, and Ray. Empty rows mean the feeds missed this cycle — nothing is invented.",
    noSwaps:
      "No signed swaps yet. An armed bot sends the next rising SOL, Zebec, Pump, ZEC, or Ray buy from the trading key. The row appears here with a Solscan link once that swap confirms.",
    bookArm:
      "Arm asks Phantom or Solflare to sign once. That signature moves 0.05 SOL and the armed USDC to a key in this browser, and that key signs each Jupiter swap. Tickets list only those signed fills. Send profits returns cash above that deposit to your wallet and leaves the rest trading. Disarm sells open tickets, then sends the leftover SOL and USDC back.",
    noOpen: "No open swap. A rising SOL, Zebec, Pump, ZEC, or Ray buy is sent from the trading key.",
    noTickets: "No live tickets yet. A swap from the trading key shows up here with a Solscan link. The bot trades a 15-minute setup once the 1-hour and 4-hour charts agree, so a quiet day can pass with no trade.",
    explorerName: "Solscan",
    settingsWallet:
      "On: The first arm signs one transaction and moves 0.05 SOL plus the armed USDC to a browser trading key. That key signs each Jupiter swap. A refresh, or arming again while that key already holds 0.05 SOL, does not move more SOL. Disarm sells open tickets, then returns leftover SOL and USDC. Off leaves every fill in this browser. Every ticket is a buy or a sell.",
    settingsMultiplier:
      "Pick spot swaps, SOL margin, or both. 5x and 10x are SOL buys only, from a $5 order. Jupiter will not open a brand-new position under $10, so a $5 order is raised to $10 when the trading key has it. Zebec, Pump, ZEC, and Ray stay a spot buy and a spot sell unless you pick margin only, which skips them. Turn on Margin only on solid 4-hour setups to wait for a 4-hour structure before a SOL perp.",
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
    swapHint: "the DEXes you leave on",
    connectBlurb:
      "No demo book. No fallback equity. The Crypto.com Onchain extension approves this origin and switches to Cronos, then the desk reads your real CRO and USDC and sizes the book from that. Settings picks USDC or CRO for each buy, and which DEXes to quote. The better one that is on is sent. About 3 CRO on Cronos EVM is enough to arm.",
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
      "Arm asks the Crypto.com Onchain extension to sign. That signature moves a trading balance to a key in this browser, and that key signs each WolfSwap, VVS, or cro.trade swap. Tickets list only those signed fills. Send profits returns cash above that deposit to your wallet and leaves the rest trading. Disarm asks the extension to sign, sells open tickets, then sends the leftover CRO and USDC back.",
    noOpen: "No open swap. A 15-minute setup that passes the 1-hour and 4-hour check is sent from the trading key.",
    noTickets:
      "No live tickets yet. A swap from the trading key shows up here with a Cronoscan link. The bot trades a 15-minute setup once the 1-hour and 4-hour charts agree, so a quiet day can pass with no trade.",
    explorerName: "Cronoscan",
    settingsWallet:
      "On: Arm asks the Crypto.com Onchain extension to sign and moves spare CRO and USDC to a browser trading key. That key quotes the DEXes you leave on and sends the better swap. Arming again while that key still holds a balance asks for a signature and does not move more CRO. Disarm asks the extension to sign, sells open tickets, then returns leftover CRO and USDC. Off leaves every fill in this browser. Every ticket is a buy or a sell.",
    settingsMultiplier:
      "Pick USDC or CRO in Trading money. A buy spends that coin on the DEXes you leave on, and a sell returns the same coin. CRO itself is skipped when the desk spends CRO. Extra size is not used.",
    settingsFive: "Does not apply. Cronos tickets stay a spot buy and a spot sell.",
    settingsTen: "Does not apply. Cronos tickets stay a spot buy and a spot sell.",
    settingsReset: "Reset wallet book is the control that clears the paper account back to the live CRO and USDC mark.",
  },
  dash: {
    id: "dash",
    kicker: "Dash",
    native: "DASH",
    bookLabel: "DASH, NEAR, ETH, QTC, and Rhea",
    walletBook: "DASH + USDT",
    swapHint: "NEAR DEX from NEAR Mobile",
    connectBlurb:
      "Connect DashPay for the Dash identity and NEAR Mobile for the account that signs. The desk reads DASH and USDT on that NEAR account and starts in practice mode, so no money moves until you turn on real money. Swaps go through the NEAR DEX.",
    connectFallback: "Connect Dash wallets",
    installHint: "Install the Dash Platform extension for DashPay, and NEAR Mobile on the phone. Then connect both.",
    armBlurb:
      "Real money asks NEAR Mobile to sign each buy and sell. DashPay stays connected so the desk knows the Dash identity. Nothing is moved to a key this site holds.",
    watchBlurb: "Paste a NEAR account to see the trades this browser saved for it. Nothing can be traded from here.",
    watchError: "That is not a NEAR account.",
    needWallet: "Connect DashPay and NEAR Mobile to trade.",
    needFunds: "priced DASH/USDT",
    scanning: "Scanning the NEAR DEX",
    waitingTick: "Waiting for the first DASH, NEAR, ETH, QTC, and Rhea tick.",
    radar: "DASH, NEAR, ETH, QTC, and Rhea. Empty rows mean the feeds missed this cycle — nothing is invented.",
    noSwaps:
      "No signed swaps yet. An armed bot sends the next 15-minute setup that passes the 1-hour and 4-hour check through the NEAR DEX. The row appears here with a NearBlocks link once that swap confirms.",
    bookArm:
      "Arm checks that DashPay and NEAR Mobile are both connected. Each buy and sell then asks NEAR Mobile to sign. Tickets list only those signed fills. Turning the bot off stops new buys. Every ticket is a buy or a sell.",
    noOpen: "No open swap. A 15-minute setup that passes the 1-hour and 4-hour check is sent through the NEAR DEX.",
    noTickets:
      "No live tickets yet. A NEAR DEX swap shows up here with a NearBlocks link. The bot trades a 15-minute setup once the 1-hour and 4-hour charts agree, so a quiet day can pass with no trade.",
    explorerName: "NearBlocks",
    settingsWallet:
      "On: Arm checks DashPay and NEAR Mobile, then each swap asks NEAR Mobile to sign a NEAR DEX trade. Off leaves every fill in this browser. Every ticket is a buy or a sell.",
    settingsMultiplier:
      "Pick USDT or DASH in Trading money. A buy spends that coin on the NEAR DEX, and a sell returns the same coin. DASH itself is skipped when the desk spends DASH. Extra size is not used.",
    settingsFive: "Does not apply. Dash tickets stay a spot buy and a spot sell.",
    settingsTen: "Does not apply. Dash tickets stay a spot buy and a spot sell.",
    settingsReset: "Reset wallet book is the control that clears the paper account back to the live DASH and USDT mark.",
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
  if (chain === "dash") return `https://nearblocks.io/txns/${signature}`;
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
    if (raw === "cronos" || raw === "solana" || raw === "dash") return raw;
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
