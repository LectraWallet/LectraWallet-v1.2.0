import * as btc from "@scure/btc-signer";
import { getBtcApiUrl, getBtcNetwork } from "./btcNetwork";
import type { BtcAccount } from "./btcWallet";

interface Utxo { txid: string; vout: number; value: number; status: { confirmed: boolean }; }
function network() { return getBtcNetwork() === "testnet" ? btc.TEST_NETWORK : btc.NETWORK; }
export async function fetchBtcBalanceSats(address: string): Promise<number> { const res = await fetch(`${getBtcApiUrl()}/address/${address}`); if (!res.ok) throw new Error("Failed to fetch BTC balance."); const data = await res.json(); return (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) + (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum); }
async function fetchUtxos(address: string): Promise<Utxo[]> { const res = await fetch(`${getBtcApiUrl()}/address/${address}/utxo`); if (!res.ok) throw new Error("Failed to fetch UTXOs."); return res.json(); }
async function fetchFeeRateSatsPerVByte(): Promise<number> { try { const res = await fetch(`${getBtcApiUrl()}/v1/fees/recommended`); if (!res.ok) throw new Error("bad response"); const data = await res.json(); return data.halfHourFee || 10; } catch { return 10; } }
export function satsToBtcString(sats: number): string { return (sats / 1e8).toFixed(8); }
export function btcStringToSats(value: string): number { const amount = Number(value); return Number.isFinite(amount) ? Math.round(amount * 1e8) : 0; }
function estimateVBytes(inputs: number, outputs: number): number { return 10 + inputs * 68 + outputs * 31; }
export async function sendBtc(account: BtcAccount, toAddress: string, amountSats: number): Promise<string> {
  const net = network(); const utxos = (await fetchUtxos(account.address)).filter((u) => u.status.confirmed); if (!utxos.length) throw new Error("No confirmed BTC funds available to spend yet.");
  const feeRate = await fetchFeeRateSatsPerVByte(); const p2wpkh = btc.p2wpkh(account.publicKey, net); const selected: Utxo[] = []; let total = 0; let fee = 0;
  for (const utxo of [...utxos].sort((a, b) => b.value - a.value)) { selected.push(utxo); total += utxo.value; fee = Math.ceil(estimateVBytes(selected.length, 2) * feeRate); if (total >= amountSats + fee) break; }
  if (total < amountSats + fee) throw new Error("Insufficient BTC balance to cover amount + network fee.");
  const change = total - amountSats - fee; const tx = new btc.Transaction();
  for (const utxo of selected) tx.addInput({ txid: utxo.txid, index: utxo.vout, witnessUtxo: { script: p2wpkh.script, amount: BigInt(utxo.value) } });
  try { tx.addOutputAddress(toAddress, BigInt(amountSats), net); } catch { throw new Error("Invalid Bitcoin recipient address for this network."); }
  if (change > 546) tx.addOutputAddress(account.address, BigInt(change), net);
  tx.sign(account.privateKey); tx.finalize(); const res = await fetch(`${getBtcApiUrl()}/tx`, { method: "POST", body: tx.hex }); if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Broadcast failed."); return res.text();
}
