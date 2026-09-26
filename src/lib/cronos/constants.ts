export const CRONOS_CHAIN_ID = "0x19";
export const CRONOS_RPCS = ["https://evm.cronos.org", "https://cronos-evm-rpc.publicnode.com"] as const;

export const WCRO = "0x5c7f8a570d578ed84e63fdfa7b1ee72deae1ae23" as const;
export const USDC = "0xc21223249ca28397b4b6541dffaecc539bff0c59" as const;
/** VVS V2 router. WCRO/USDC swaps land here. */
export const VVS_ROUTER = "0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae" as const;

/** Left on the user wallet so a later disarm can still be signed. */
export const USER_KEEP_CRO = 2;
/** The trading key needs this much CRO to pay for a swap. */
export const BOT_MIN_CRO = 1;
/** Stays on the trading key when a close sells CRO. */
export const GAS_CRO = 0.5;

export const SLIPPAGE_BPS = 80;
