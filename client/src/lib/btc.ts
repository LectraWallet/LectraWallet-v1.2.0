import * as btc from "@scure/btc-signer";
import { getBtcApiUrl, getBtcNetwork } from "./btcNetwork";
import type { BtcAccount } from "./btcWallet";

export type FeeTarget = "economy" | "normal" | "priority" | "custom";

export interface FeeRates {
  economy: number;
  normal: number;
  priority: number;
  minimum: number;
  updatedAt: number;
}

export interface FeePolicy {
  target: FeeTarget;
  customRate?: number;
}

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

export interface WalletUtxo extends Utxo {
  account: BtcAccount;
}

export interface CoinSelection {
  selected: WalletUtxo[];
  totalSats: number;
  feeSats: number;
  changeSats: number;
  estimatedVBytes: number;
  effectiveFeeRate: number;
}

export interface PlannedInput {
  txid: string;
  vout: number;
  value: number;
  address: string;
  path: string;
}

export interface TransactionPlan {
  recipientAddress: string;
  amountSats: number;
  changeAddress?: string;
  inputs: PlannedInput[];
  totalInputSats: number;
  feeSats: number;
  changeSats: number;
  estimatedVBytes: number;
  feeRate: number;
  psbtBase64: string;
  unsignedTxBase64: string;
}

export interface HistoryEntry {
  txid: string;
  direction: "received" | "sent" | "self";
  amountSats: number;
  confirmed: boolean;
  confirmations: number;
  timestamp?: number;
}

const DUST_LIMIT_SATS = 546;
const MAX_FEE_RATE = 10_000;
const MAX_AMOUNT_SATS = 2_100_000_000_000_000;
const MAX_SELECTION_SEARCH = 75_000;

function network() {
  return getBtcNetwork() === "testnet" ? btc.TEST_NETWORK : btc.NETWORK;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

async function safeFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(`${getBtcApiUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export function validateBitcoinAddress(
  value: string
):
  | { valid: true; address: string; type: string }
  | { valid: false; error: string } {
  const address = value.trim();
  if (
    !address ||
    address.length < 14 ||
    address.length > 90 ||
    /\s/.test(address)
  )
    return {
      valid: false,
      error: "Enter a complete Bitcoin address without spaces.",
    };
  const lower = address.toLowerCase();
  const upper = address.toUpperCase();
  if (
    (lower.startsWith("bc1") || lower.startsWith("tb1")) &&
    address !== lower &&
    address !== upper
  ) {
    return {
      valid: false,
      error:
        "Bech32 Bitcoin addresses cannot mix uppercase and lowercase characters.",
    };
  }
  try {
    const decoded = btc.Address(network()).decode(address);
    if (!["pkh", "sh", "wpkh", "tr"].includes(decoded.type))
      return { valid: false, error: "Unsupported Bitcoin output type." };
    return {
      valid: true,
      address:
        lower.startsWith("bc1") || lower.startsWith("tb1") ? lower : address,
      type: decoded.type,
    };
  } catch {
    return {
      valid: false,
      error: `Invalid Bitcoin ${getBtcNetwork()} address or checksum.`,
    };
  }
}

function outputVBytesForType(type: string): number {
  // 8-byte value + 1-byte compact script length + script bytes.
  if (type === "pkh") return 34;
  if (type === "sh") return 32;
  if (type === "wpkh") return 31;
  if (type === "tr") return 43;
  throw new Error("Unsupported Bitcoin output type.");
}

export function parseBitcoinUri(
  value: string
): { address: string; amountBtc?: string } | null {
  const raw = value.trim();
  if (!raw) return null;
  const match = raw.match(/^bitcoin:([^?]+)(?:\?(.*))?$/i);
  if (!match) return { address: raw };
  const address = decodeURIComponent(match[1]);
  const params = new URLSearchParams(match[2] ?? "");
  return { address, amountBtc: params.get("amount") ?? undefined };
}

export async function fetchBtcBalanceSats(address: string): Promise<number> {
  const res = await safeFetch(`/address/${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error("Failed to fetch BTC balance.");
  const data = (await res.json()) as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  };
  const total =
    (data.chain_stats?.funded_txo_sum ?? 0) -
    (data.chain_stats?.spent_txo_sum ?? 0) +
    (data.mempool_stats?.funded_txo_sum ?? 0) -
    (data.mempool_stats?.spent_txo_sum ?? 0);
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error("Received an invalid balance from the Bitcoin service.");
  return total;
}

export async function fetchWalletBalanceSats(
  accounts: BtcAccount[]
): Promise<number> {
  const balances = await Promise.all(
    accounts.map(account => fetchBtcBalanceSats(account.address))
  );
  return balances.reduce((total, value) => total + value, 0);
}

export async function fetchUtxos(address: string): Promise<Utxo[]> {
  const res = await safeFetch(`/address/${encodeURIComponent(address)}/utxo`);
  if (!res.ok) throw new Error("Failed to fetch UTXOs.");
  const rows = (await res.json()) as unknown[];
  if (!Array.isArray(rows)) throw new Error("Received invalid UTXO data.");
  return rows.map(row => {
    const item = row as Partial<Utxo>;
    if (
      typeof item.txid !== "string" ||
      !/^[0-9a-f]{64}$/i.test(item.txid) ||
      !Number.isInteger(item.vout) ||
      (item.vout ?? -1) < 0 ||
      safeNumber(item.value) === null ||
      !item.status ||
      typeof item.status.confirmed !== "boolean"
    ) {
      throw new Error("Received invalid UTXO data.");
    }
    return item as Utxo;
  });
}

export async function fetchWalletUtxos(
  accounts: BtcAccount[]
): Promise<WalletUtxo[]> {
  const results = await Promise.all(
    accounts.map(async account =>
      (await fetchUtxos(account.address)).map(utxo => ({ ...utxo, account }))
    )
  );
  return results.flat();
}

export async function fetchRecommendedFeeRates(): Promise<FeeRates> {
  try {
    const res = await safeFetch("/v1/fees/recommended");
    if (!res.ok) throw new Error("Fee service unavailable");
    const data = (await res.json()) as Record<string, unknown>;
    const floor = safeNumber(data.minimumFee) ?? 1;
    const normalize = (value: unknown, fallback: number) =>
      Math.min(MAX_FEE_RATE, Math.max(floor, safeNumber(value) ?? fallback));
    const priority = normalize(data.fastestFee, 12);
    const normal = normalize(data.halfHourFee, Math.max(6, floor));
    const economy = normalize(data.economyFee, Math.max(2, floor));
    return { economy, normal, priority, minimum: floor, updatedAt: Date.now() };
  } catch {
    return {
      economy: 2,
      normal: 6,
      priority: 12,
      minimum: 1,
      updatedAt: Date.now(),
    };
  }
}

export function resolveFeeRate(policy: FeePolicy, rates: FeeRates): number {
  const rate =
    policy.target === "custom" ? policy.customRate : rates[policy.target];
  if (
    typeof rate !== "number" ||
    !Number.isFinite(rate) ||
    !Number.isInteger(rate) ||
    rate < rates.minimum ||
    rate > MAX_FEE_RATE
  )
    throw new Error(
      `Enter a whole-number fee rate between ${rates.minimum} and ${MAX_FEE_RATE} sat/vB.`
    );
  return rate;
}

export function satsToBtcString(sats: number): string {
  return (sats / 1e8).toFixed(8);
}

export function btcStringToSats(value: string): number {
  const trimmed = value.trim();
  const match = trimmed.match(/^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/);
  if (!match) return 0;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(8, "0") || "0");
  const sats = whole * BigInt(100_000_000) + fraction;
  return sats <= BigInt(MAX_AMOUNT_SATS) ? Number(sats) : 0;
}

export function estimateP2wpkhVBytes(
  inputCount: number,
  outputCount: number | number[]
): number {
  const outputs = Array.isArray(outputCount)
    ? outputCount
    : Array.from({ length: outputCount }, () => 31);
  if (
    !Number.isInteger(inputCount) ||
    inputCount <= 0 ||
    !outputs.length ||
    outputs.some(size => !Number.isInteger(size) || size <= 0)
  )
    throw new Error("Transaction must include inputs and outputs.");
  // 68.5 vB/input is a conservative P2WPKH estimate that covers standard DER signature variance.
  return Math.ceil(
    10.5 + inputCount * 68.5 + outputs.reduce((total, size) => total + size, 0)
  );
}

function evaluateSelection(
  selected: WalletUtxo[],
  amountSats: number,
  feeRate: number,
  recipientOutputVBytes: number
): CoinSelection | null {
  const totalSats = selected.reduce((total, utxo) => total + utxo.value, 0);
  const feeWithChange =
    estimateP2wpkhVBytes(selected.length, [recipientOutputVBytes, 31]) *
    feeRate;
  if (totalSats >= amountSats + feeWithChange) {
    const changeSats = totalSats - amountSats - feeWithChange;
    if (changeSats >= DUST_LIMIT_SATS)
      return {
        selected,
        totalSats,
        feeSats: feeWithChange,
        changeSats,
        estimatedVBytes: estimateP2wpkhVBytes(selected.length, [
          recipientOutputVBytes,
          31,
        ]),
        effectiveFeeRate: feeRate,
      };
  }
  const feeWithoutChange =
    estimateP2wpkhVBytes(selected.length, [recipientOutputVBytes]) * feeRate;
  if (totalSats >= amountSats + feeWithoutChange) {
    const feeSats = totalSats - amountSats;
    return {
      selected,
      totalSats,
      feeSats,
      changeSats: 0,
      estimatedVBytes: estimateP2wpkhVBytes(selected.length, [
        recipientOutputVBytes,
      ]),
      effectiveFeeRate:
        feeSats /
        estimateP2wpkhVBytes(selected.length, [recipientOutputVBytes]),
    };
  }
  return null;
}

function selectionScore(selection: CoinSelection): [number, number, number] {
  const excess =
    selection.changeSats > 0
      ? selection.changeSats
      : selection.feeSats -
        selection.estimatedVBytes * selection.effectiveFeeRate;
  return [Math.max(0, excess), selection.selected.length, selection.totalSats];
}

function scoreIsBetter(
  candidate: CoinSelection,
  current: CoinSelection | null
): boolean {
  if (!current) return true;
  const left = selectionScore(candidate);
  const right = selectionScore(current);
  return (
    left[0] < right[0] ||
    (left[0] === right[0] &&
      (left[1] < right[1] || (left[1] === right[1] && left[2] < right[2])))
  );
}

export function selectCoins(
  utxos: WalletUtxo[],
  amountSats: number,
  feeRate: number,
  recipientOutputVBytes = 31
): CoinSelection {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0)
    throw new Error("Amount must be a positive whole number of satoshis.");
  if (!Number.isSafeInteger(feeRate) || feeRate <= 0 || feeRate > MAX_FEE_RATE)
    throw new Error("Fee rate is outside the allowed range.");
  const spendable = utxos
    .filter(
      utxo =>
        utxo.status.confirmed &&
        Number.isSafeInteger(utxo.value) &&
        utxo.value > 0
    )
    .sort((a, b) => b.value - a.value);
  if (!spendable.length)
    throw new Error("No confirmed BTC funds are available to spend yet.");
  let best: CoinSelection | null = null;
  let attempts = 0;
  const candidates = spendable.slice(0, 18);
  const search = (
    index: number,
    selected: WalletUtxo[],
    total: number
  ): void => {
    if (attempts++ >= MAX_SELECTION_SEARCH) return;
    if (selected.length) {
      const evaluated = evaluateSelection(
        selected,
        amountSats,
        feeRate,
        recipientOutputVBytes
      );
      if (evaluated && scoreIsBetter(evaluated, best)) best = evaluated;
    }
    if (index >= candidates.length || selected.length >= 15) return;
    const minimumNeeded =
      amountSats +
      estimateP2wpkhVBytes(selected.length + 1, [recipientOutputVBytes]) *
        feeRate;
    if (total >= minimumNeeded && best) return;
    search(
      index + 1,
      [...selected, candidates[index]],
      total + candidates[index].value
    );
    search(index + 1, selected, total);
  };
  search(0, [], 0);
  if (best) return best;
  const greedy: WalletUtxo[] = [];
  for (const utxo of spendable) {
    greedy.push(utxo);
    const evaluated = evaluateSelection(
      greedy,
      amountSats,
      feeRate,
      recipientOutputVBytes
    );
    if (evaluated) return evaluated;
  }
  throw new Error(
    "Insufficient confirmed BTC to cover the amount and network fee."
  );
}

function addPlanInput(transaction: btc.Transaction, utxo: WalletUtxo): void {
  const payment = btc.p2wpkh(utxo.account.publicKey, network());
  transaction.addInput({
    txid: utxo.txid,
    index: utxo.vout,
    witnessUtxo: { script: payment.script, amount: BigInt(utxo.value) },
    bip32Derivation: [
      [
        utxo.account.publicKey,
        {
          fingerprint: utxo.account.masterFingerprint,
          path: btc.bip32Path(utxo.account.path),
        },
      ],
    ],
  });
}

export function buildTransactionPlan(params: {
  utxos: WalletUtxo[];
  recipientAddress: string;
  amountSats: number;
  feeRate: number;
  changeAccount: BtcAccount;
}): TransactionPlan {
  const recipient = validateBitcoinAddress(params.recipientAddress);
  if (!recipient.valid) throw new Error(recipient.error);
  const selection = selectCoins(
    params.utxos,
    params.amountSats,
    params.feeRate,
    outputVBytesForType(recipient.type)
  );
  const transaction = new btc.Transaction({
    unknown: "strict",
    proprietary: "strict",
  });
  selection.selected.forEach(utxo => addPlanInput(transaction, utxo));
  transaction.addOutputAddress(
    recipient.address,
    BigInt(params.amountSats),
    network()
  );
  if (selection.changeSats > 0)
    transaction.addOutputAddress(
      params.changeAccount.address,
      BigInt(selection.changeSats),
      network()
    );
  return {
    recipientAddress: recipient.address,
    amountSats: params.amountSats,
    changeAddress:
      selection.changeSats > 0 ? params.changeAccount.address : undefined,
    inputs: selection.selected.map(utxo => ({
      txid: utxo.txid,
      vout: utxo.vout,
      value: utxo.value,
      address: utxo.account.address,
      path: utxo.account.path,
    })),
    totalInputSats: selection.totalSats,
    feeSats: selection.feeSats,
    changeSats: selection.changeSats,
    estimatedVBytes: selection.estimatedVBytes,
    feeRate: params.feeRate,
    psbtBase64: bytesToBase64(transaction.toPSBT()),
    unsignedTxBase64: bytesToBase64(transaction.unsignedTx),
  };
}

export function signTransactionPlan(
  plan: TransactionPlan,
  accounts: BtcAccount[]
): { hex: string; txid: string; actualVBytes: number; actualFeeSats: number } {
  const transaction = btc.Transaction.fromPSBT(
    bytesFromBase64(plan.psbtBase64),
    { unknown: "strict", proprietary: "strict" }
  );
  const accountsByPath = new Map(
    accounts.map(account => [account.path, account])
  );
  for (const input of plan.inputs) {
    const account = accountsByPath.get(input.path);
    if (!account)
      throw new Error("A signing key for one selected input is unavailable.");
    transaction.sign(account.privateKey);
  }
  transaction.finalize();
  const actualFeeSats = Number(transaction.fee);
  if (!Number.isSafeInteger(actualFeeSats) || actualFeeSats !== plan.feeSats)
    throw new Error(
      "Transaction fee changed unexpectedly. Rebuild and review the transaction."
    );
  return {
    hex: transaction.hex,
    txid: transaction.id,
    actualVBytes: transaction.vsize,
    actualFeeSats,
  };
}

export function validateSignedPsbt(
  plan: TransactionPlan,
  signedPsbtBase64: string
): { hex: string; txid: string; actualVBytes: number; actualFeeSats: number } {
  const transaction = btc.Transaction.fromPSBT(
    bytesFromBase64(signedPsbtBase64),
    { unknown: "strict", proprietary: "strict" }
  );
  if (
    !bytesEqual(transaction.unsignedTx, bytesFromBase64(plan.unsignedTxBase64))
  )
    throw new Error(
      "The signed PSBT does not match the transaction you reviewed."
    );
  if (!transaction.isFinal)
    throw new Error("The imported PSBT is not fully signed and finalized.");
  const actualFeeSats = Number(transaction.fee);
  if (!Number.isSafeInteger(actualFeeSats) || actualFeeSats !== plan.feeSats)
    throw new Error(
      "The signed PSBT fee does not match the reviewed transaction."
    );
  return {
    hex: transaction.hex,
    txid: transaction.id,
    actualVBytes: transaction.vsize,
    actualFeeSats,
  };
}

export async function broadcastTransactionHex(hex: string): Promise<string> {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 20 || hex.length % 2)
    throw new Error("Invalid signed transaction payload.");
  const res = await safeFetch("/tx", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: hex,
  });
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(text || "Broadcast failed.");
  if (!/^[0-9a-f]{64}$/i.test(text))
    throw new Error(
      "The broadcast service returned an invalid transaction ID."
    );
  return text;
}

interface MempoolTx {
  txid: string;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
  vin: Array<{ prevout?: { scriptpubkey_address?: string; value?: number } }>;
  vout: Array<{ scriptpubkey_address?: string; value?: number }>;
}

export async function fetchTransactionHistory(
  accounts: BtcAccount[]
): Promise<HistoryEntry[]> {
  const ownAddresses = new Set(accounts.map(account => account.address));
  const [tipResponse, ...responses] = await Promise.all([
    safeFetch("/blocks/tip/height"),
    ...accounts.map(account =>
      safeFetch(`/address/${encodeURIComponent(account.address)}/txs`)
    ),
  ]);
  const tip = tipResponse.ok ? Number(await tipResponse.text()) : undefined;
  const transactions = new Map<string, MempoolTx>();
  for (const response of responses) {
    if (!response.ok) continue;
    const rows = (await response.json()) as MempoolTx[];
    if (Array.isArray(rows))
      rows.forEach(transaction => {
        if (/^[0-9a-f]{64}$/i.test(transaction.txid))
          transactions.set(transaction.txid, transaction);
      });
  }
  const entries: HistoryEntry[] = Array.from(transactions.values()).map(
    (transaction: MempoolTx): HistoryEntry => {
      const received = transaction.vout.reduce<number>(
        (
          total: number,
          output: { scriptpubkey_address?: string; value?: number }
        ) =>
          ownAddresses.has(output.scriptpubkey_address ?? "")
            ? total + (safeNumber(output.value) ?? 0)
            : total,
        0
      );
      const spent = transaction.vin.reduce<number>(
        (
          total: number,
          input: { prevout?: { scriptpubkey_address?: string; value?: number } }
        ) =>
          ownAddresses.has(input.prevout?.scriptpubkey_address ?? "")
            ? total + (safeNumber(input.prevout?.value) ?? 0)
            : total,
        0
      );
      const net = received - spent;
      const direction: HistoryEntry["direction"] =
        net > 0 ? "received" : net < 0 ? "sent" : "self";
      const confirmed = Boolean(transaction.status?.confirmed);
      const confirmations =
        confirmed &&
        Number.isInteger(tip) &&
        Number.isInteger(transaction.status?.block_height)
          ? Math.max(1, tip! - transaction.status.block_height! + 1)
          : 0;
      return {
        txid: transaction.txid,
        direction,
        amountSats: Math.abs(net),
        confirmed,
        confirmations,
        timestamp: transaction.status?.block_time,
      };
    }
  );
  return entries.sort(
    (left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0)
  );
}
