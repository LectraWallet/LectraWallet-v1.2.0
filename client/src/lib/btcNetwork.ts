export type BtcNetworkName = "mainnet" | "testnet";

export function getBtcNetwork(): BtcNetworkName {
  return import.meta.env.VITE_BTC_NETWORK === "testnet" ? "testnet" : "mainnet";
}

export function getBtcApiUrl(): string {
  const custom = import.meta.env.VITE_BTC_API_URL?.replace(/\/$/, "");
  if (custom) return custom;
  return getBtcNetwork() === "mainnet" ? "https://mempool.space/api" : "https://mempool.space/testnet/api";
}

export function getBtcExplorerTxUrl(txid: string): string {
  return getBtcNetwork() === "mainnet" ? `https://mempool.space/tx/${txid}` : `https://mempool.space/testnet/tx/${txid}`;
}

export function getBtcExplorerAddressUrl(address: string): string {
  return getBtcNetwork() === "mainnet" ? `https://mempool.space/address/${address}` : `https://mempool.space/testnet/address/${address}`;
}
