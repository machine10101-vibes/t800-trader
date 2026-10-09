export const CRONOS_CHAIN_ID = "0x19";
export const CRONOS_RPCS = [
  "https://evm-cronos.crypto.org",
  "https://evm.cronos.org",
  "https://cronos-evm-rpc.publicnode.com",
  "https://rpc.vvs.finance",
  "https://cronos.drpc.org",
] as const;

export const CRONOS_POS_LCDS = [
  "https://rest.mainnet.crypto.org",
  "https://rest.cosmos.directory/cryptoorgchain",
] as const;

export const WCRO = "0x5c7f8a570d578ed84e63fdfa7b1ee72deae1ae23" as const;
export const USDC = "0xc21223249ca28397b4b6541dffaecc539bff0c59" as const;
/** VVS V2 router. Direct VVS fills go here. cro.trade wraps this same path when its quote wins. */
export const VVS_ROUTER = "0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae" as const;
/**
 * cro.trade spot router. It takes a path and a DEX router.
 * The smartBuy ABI in the cro.trade site is not on this contract.
 */
export const CRO_TRADE_ROUTER = "0xc3E7e9e4e0923C057f1801A985Eeb9B6cCffEC60" as const;
/** cro.trade documents a 0.9% spot fee. It is taken off the VVS quote before the two venues are compared. */
export const CRO_TRADE_FEE_BPS = 90;

/** Left on the user wallet so a later disarm can still be signed. */
export const USER_KEEP_CRO = 2;
/** The trading key needs this much CRO to pay for a swap. */
export const BOT_MIN_CRO = 1;
/** Stays on the trading key when a close sells CRO. */
export const GAS_CRO = 0.5;

export const SLIPPAGE_BPS = 80;
