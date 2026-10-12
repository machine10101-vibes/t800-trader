/** DASH on NEAR. The liquid market is the NEAR DEX DASH/USDT pool. */
export const DASH_TOKEN = "dash.omft.near";
export const WRAP_NEAR = "wrap.near";
/** USDT the DASH pool quotes. Buys spend this when the desk is on USDT. */
export const NEAR_USDT = "eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near";
export const ETH_NEAR = "eth.omft.near";
export const QTC_NEAR = "qtc.omft.near";
export const RHEA_TOKEN = "token.rhealab.near";

export const DASH_POOL =
  "nep141:dash.omft.near___nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near";
export const NEAR_POOL =
  "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near___nep141:wrap.near";
export const ETH_POOL = "nep141:eth.omft.near___nep141:wrap.near";
export const QTC_POOL = "nep141:qtc.omft.near___nep141:wrap.near";
export const RHEA_POOL = "refv1-6458";

export const TOKEN_DECIMALS: Record<string, number> = {
  [DASH_TOKEN]: 8,
  [WRAP_NEAR]: 24,
  [NEAR_USDT]: 6,
  [ETH_NEAR]: 18,
  [QTC_NEAR]: 12,
  [RHEA_TOKEN]: 18,
};

/** NEAR Intents quote. Unauthenticated quotes still return a deposit address. */
export const NEAR_DEX_QUOTE = "https://1click.chaindefuser.com/v0/quote";

export const NEAR_RPC = "https://rpc.mainnet.near.org";

export const NEAR_MOBILE_API = "https://near-mobile-signer-backend_production.peersyst.tech";
export const NEAR_MOBILE_LINK = "near-mobile-wallet://sign";

export const DASHPAY_INSTALL = "https://chromewebstore.google.com/detail/dash-platform-extension/odmphbcnlldggfhcpdjgnlhbehoicdnf";
export const NEAR_MOBILE_INSTALL = "https://nearmobile.app/";

export function tokenDecimals(contract: string): number {
  return TOKEN_DECIMALS[contract] ?? 18;
}

export function intentAsset(contract: string): string {
  return contract.startsWith("nep141:") ? contract : `nep141:${contract}`;
}
