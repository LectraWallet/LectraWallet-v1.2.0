import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { QRCodeSVG } from "qrcode.react";
import {
  broadcastTransactionHex,
  buildTransactionPlan,
  btcStringToSats,
  fetchRecommendedFeeRates,
  fetchTransactionHistory,
  fetchWalletBalanceSats,
  fetchWalletUtxos,
  parseBitcoinUri,
  resolveFeeRate,
  satsToBtcString,
  signTransactionPlan,
  validateBitcoinAddress,
  validateSignedPsbt,
  type FeePolicy,
  type FeeRates,
  type HistoryEntry,
  type TransactionPlan,
} from "@/lib/btc";
import {
  createNewMnemonic,
  deriveChangeAccounts,
  deriveReceiveAccounts,
  isValidMnemonic,
  type BtcAccount,
} from "@/lib/btcWallet";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  clearStoredWallet,
  hasStoredWallet,
  loadEncryptedWallet,
  loadWalletMetadata,
  saveEncryptedWallet,
  saveWalletMetadata,
} from "@/lib/storage";
import {
  getBtcExplorerAddressUrl,
  getBtcExplorerTxUrl,
  getBtcNetwork,
} from "@/lib/btcNetwork";
import {
  installBrowserSecurityGuards,
  inspectBrowserSecurity,
  writeSafeClipboard,
} from "@/lib/browserSecurity";

type Screen = "loading" | "onboard" | "unlock" | "dashboard";
type OnboardMode = "choose" | "create" | "import";
type Tab = "receive" | "send";
type PasswordFieldsProps = {
  password: string;
  confirmPassword: string;
  setPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
};

export default function Home() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [onboardMode, setOnboardMode] = useState<OnboardMode>("choose");
  const [tab, setTab] = useState<Tab>("receive");
  const [account, setAccount] = useState<BtcAccount | null>(null);
  const [receiveAccounts, setReceiveAccounts] = useState<BtcAccount[]>([]);
  const [changeAccounts, setChangeAccounts] = useState<BtcAccount[]>([]);
  const [receiveIndex, setReceiveIndex] = useState(0);
  const [changeIndex, setChangeIndex] = useState(0);
  const [balanceSats, setBalanceSats] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [mnemonic, setMnemonic] = useState("");
  const [mnemonicConfirmed, setMnemonicConfirmed] = useState(false);
  const [importText, setImportText] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [feeTarget, setFeeTarget] = useState<FeePolicy["target"]>("normal");
  const [customFee, setCustomFee] = useState("");
  const [feeRates, setFeeRates] = useState<FeeRates | null>(null);
  const [pendingPlan, setPendingPlan] = useState<TransactionPlan | null>(null);
  const [hardwarePsbt, setHardwarePsbt] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [phraseCopied, setPhraseCopied] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [startOfDayValue, setStartOfDayValue] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const network = getBtcNetwork();

  useEffect(() => {
    const security = inspectBrowserSecurity();
    if (!security.safe) setNotice(security.reason ?? "Unsafe browser context.");
    const cleanup = installBrowserSecurityGuards(reason => {
      setAccount(null);
      setReceiveAccounts([]);
      setChangeAccounts([]);
      setScreen("unlock");
      setNotice(reason);
    });
    setScreen(hasStoredWallet() ? "unlock" : "onboard");
    return cleanup;
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;
    const reader = new BrowserMultiFormatReader();
    let stopped = false;
    void reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current,
        result => {
          if (stopped || !result) return;
          const parsed = parseBitcoinUri(result.getText().trim());
          if (parsed) {
            setSendTo(parsed.address);
            if (parsed.amountBtc) setSendAmount(parsed.amountBtc);
          }
          setScannerOpen(false);
          setTab("send");
          setNotice("QR code scanned");
        }
      )
      .catch(() =>
        setNotice(
          "Camera access was unavailable. You can paste an address instead."
        )
      );
    return () => {
      stopped = true;
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [scannerOpen]);

  const loadAccounts = useCallback(
    (phrase: string, receiveAt = 0, changeAt = 0) => {
      const receives = deriveReceiveAccounts(
        phrase,
        Math.max(receiveAt + 5, 5)
      );
      const changes = deriveChangeAccounts(phrase, Math.max(changeAt + 5, 5));
      setReceiveAccounts(receives);
      setChangeAccounts(changes);
      setReceiveIndex(receiveAt);
      setChangeIndex(changeAt);
      setAccount(receives[receiveAt]);
    },
    []
  );
  const refreshBalance = useCallback(async () => {
    if (!receiveAccounts.length && !changeAccounts.length) return;
    setBalanceLoading(true);
    try {
      setBalanceSats(
        await fetchWalletBalanceSats([...receiveAccounts, ...changeAccounts])
      );
    } catch {
      setNotice("Could not refresh the balance right now.");
    } finally {
      setBalanceLoading(false);
    }
  }, [receiveAccounts, changeAccounts]);
  const refreshHistory = useCallback(async () => {
    if (!receiveAccounts.length && !changeAccounts.length) return;
    try {
      setHistory(
        await fetchTransactionHistory([...receiveAccounts, ...changeAccounts])
      );
    } catch {
      setNotice("Could not refresh transaction history.");
    }
  }, [receiveAccounts, changeAccounts]);
  useEffect(() => {
    void refreshBalance();
    void refreshHistory();
  }, [refreshBalance, refreshHistory]);
  const loadPrice = useCallback(async () => {
    try {
      const response = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
        { referrerPolicy: "no-referrer" }
      );
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { bitcoin?: { usd?: number } };
      if (typeof data.bitcoin?.usd !== "number") throw new Error();
      setBtcPrice(data.bitcoin.usd);
      setPriceError(null);
    } catch {
      setPriceError("Price unavailable");
    }
  }, []);
  useEffect(() => {
    void loadPrice();
    const timer = window.setInterval(() => void loadPrice(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadPrice]);
  useEffect(() => {
    if (!account || balanceSats === null || btcPrice === null) return;
    const key = `bitcoin-wallet:stats:${account.address}:${new Date().toISOString().slice(0, 10)}`;
    const currentValue = (balanceSats / 100_000_000) * btcPrice;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const snapshot = JSON.parse(saved) as { value?: number };
        if (typeof snapshot.value === "number") {
          setStartOfDayValue(snapshot.value);
          return;
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
    localStorage.setItem(
      key,
      JSON.stringify({ value: currentValue, createdAt: Date.now() })
    );
    setStartOfDayValue(currentValue);
  }, [account, balanceSats, btcPrice]);

  function startCreate() {
    setMnemonic(createNewMnemonic());
    setMnemonicConfirmed(false);
    setOnboardMode("create");
    setError(null);
  }
  async function finishSetup(phrase: string) {
    setError(null);
    if (password.length < 10)
      return setError("Choose a password with at least 10 characters.");
    if (password !== confirmPassword) return setError("Passwords don't match.");
    saveEncryptedWallet(await encryptSecret(phrase.trim(), password));
    saveWalletMetadata({
      receiveIndex: 0,
      changeIndex: 0,
      lastScannedReceiveIndex: 0,
      lastScannedChangeIndex: 0,
    });
    loadAccounts(phrase.trim());
    setMnemonic("");
    setPassword("");
    setConfirmPassword("");
    setImportText("");
    setScreen("dashboard");
  }
  function normalizePhrase(value: string) {
    return value
      .normalize("NFKD")
      .replace(/\b(?:word\s*)?\d{1,2}[.)]?\s*/gi, " ")
      .replace(/[,\n\r\t]+/g, " ")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }
  function finishImport() {
    setError(null);
    const phrase = normalizePhrase(importText);
    if (!isValidMnemonic(phrase))
      return setError(
        "Enter a valid 12, 15, 18, 21, or 24-word recovery phrase."
      );
    void finishSetup(phrase);
  }
  async function unlock() {
    setError(null);
    const blob = loadEncryptedWallet();
    if (!blob) return setScreen("onboard");
    try {
      const phrase = await decryptSecret(blob, password);
      const meta = loadWalletMetadata();
      loadAccounts(phrase, meta.receiveIndex, meta.changeIndex);
      setPassword("");
      setScreen("dashboard");
    } catch {
      setError("Incorrect password.");
    }
  }
  function lock() {
    [...receiveAccounts, ...changeAccounts].forEach(account => {
      account.privateKey.fill(0);
      account.publicKey.fill(0);
    });
    setAccount(null);
    setReceiveAccounts([]);
    setChangeAccounts([]);
    setBalanceSats(null);
    setPendingPlan(null);
    setScreen("unlock");
  }
  function resetWallet() {
    if (
      !window.confirm(
        "Remove this wallet from this browser? You will need your recovery phrase to restore it."
      )
    )
      return;
    clearStoredWallet();
    lock();
    setOnboardMode("choose");
    setScreen("onboard");
  }
  function rotateReceiveAddress() {
    const next = receiveIndex + 1;
    const nextAccount = receiveAccounts[next];
    if (!nextAccount)
      return setNotice(
        "Address gap limit reached. Unlock again before rotating further."
      );
    setReceiveIndex(next);
    setAccount(nextAccount);
    const metadata = loadWalletMetadata();
    saveWalletMetadata({
      ...metadata,
      receiveIndex: next,
      lastScannedReceiveIndex: Math.max(metadata.lastScannedReceiveIndex, next),
    });
    setNotice("New receiving address generated.");
  }
  async function prepareSend() {
    setSendError(null);
    setSendResult(null);
    if (!account) return;
    const parsed = parseBitcoinUri(sendTo.trim());
    const recipient = validateBitcoinAddress(parsed?.address ?? sendTo.trim());
    if (!recipient.valid) return setSendError(recipient.error);
    const sats = btcStringToSats(parsed?.amountBtc ?? sendAmount);
    if (!Number.isSafeInteger(sats) || sats <= 0)
      return setSendError("Enter a valid amount greater than 0.");
    try {
      const rates = feeRates ?? (await fetchRecommendedFeeRates());
      setFeeRates(rates);
      const rate = resolveFeeRate(
        {
          target: feeTarget,
          customRate: feeTarget === "custom" ? Number(customFee) : undefined,
        },
        rates
      );
      const utxos = await fetchWalletUtxos([
        ...receiveAccounts,
        ...changeAccounts,
      ]);
      const change = changeAccounts[changeIndex] ?? account;
      const plan = buildTransactionPlan({
        utxos,
        recipientAddress: recipient.address,
        amountSats: sats,
        feeRate: rate,
        changeAccount: change,
      });
      setPendingPlan(plan);
      setNotice("Review the transaction before signing.");
    } catch (e) {
      setSendError(
        e instanceof Error ? e.message : "Could not build a transaction."
      );
    }
  }
  async function signAndBroadcast() {
    if (!pendingPlan || !receiveAccounts.length) return;
    setSending(true);
    setSendError(null);
    try {
      const signed = signTransactionPlan(pendingPlan, [
        ...receiveAccounts,
        ...changeAccounts,
      ]);
      const txid = await broadcastTransactionHex(signed.hex);
      setSendResult(txid);
      setPendingPlan(null);
      setSendTo("");
      setSendAmount("");
      void refreshBalance();
      void refreshHistory();
    } catch (e) {
      setSendError(
        e instanceof Error ? e.message : "Signing or broadcast failed."
      );
    } finally {
      setSending(false);
    }
  }
  async function importHardwarePsbt() {
    if (!pendingPlan || !hardwarePsbt.trim())
      return setSendError(
        "Paste the signed PSBT from your hardware wallet first."
      );
    setSending(true);
    try {
      const signed = validateSignedPsbt(pendingPlan, hardwarePsbt.trim());
      const txid = await broadcastTransactionHex(signed.hex);
      setSendResult(txid);
      setPendingPlan(null);
      setHardwarePsbt("");
      void refreshBalance();
      void refreshHistory();
    } catch (e) {
      setSendError(
        e instanceof Error
          ? e.message
          : "The hardware-wallet PSBT was rejected."
      );
    } finally {
      setSending(false);
    }
  }
  async function copyAddress() {
    if (!account) return;
    await writeSafeClipboard(account.address);
    setCopied(true);
    setNotice("Address copied");
    window.setTimeout(() => setCopied(false), 1800);
  }
  async function copyPhrase() {
    if (
      !mnemonic ||
      !window.confirm(
        "Recovery phrases in the clipboard can be exposed to other apps. Continue?"
      )
    )
      return;
    await writeSafeClipboard(mnemonic);
    setPhraseCopied(true);
    setNotice("Recovery phrase copied; clear your clipboard after use.");
    window.setTimeout(() => setPhraseCopied(false), 1800);
  }
  async function pastePhrase() {
    if (
      !window.confirm(
        "Only paste a recovery phrase from a trusted source. Continue?"
      )
    )
      return;
    try {
      setImportText(normalizePhrase(await navigator.clipboard.readText()));
      setError(null);
      setNotice("Recovery phrase pasted");
    } catch {
      setError("Clipboard access was blocked. Paste the phrase manually.");
    }
  }

  if (screen === "loading") return null;
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="top-controls">
          <button className="coin-toggle" aria-label="Bitcoin network">
            Bitcoin
          </button>
        </div>
        {screen === "dashboard" ? (
          <button className="settings-button" onClick={lock}>
            Lock
          </button>
        ) : (
          <div className="brand">Lectra Wallet</div>
        )}
      </header>
      {screen === "onboard" && onboardMode === "choose" && (
        <section className="welcome page-section">
          <p className="eyebrow">PRIVATE BY DEFAULT</p>
          <h1>
            Your bitcoin.
            <br />
            <span>Your keys.</span>
          </h1>
          <p className="intro">
            A simple self-custody wallet for Bitcoin mainnet. Your recovery
            phrase stays encrypted in this browser.
          </p>
          <button className="primary-button" onClick={startCreate}>
            Create new wallet
          </button>
          <button
            className="button-quiet"
            onClick={() => {
              setOnboardMode("import");
              setError(null);
            }}
          >
            Restore existing wallet
          </button>
          <p className="fine-print">
            No account. No identity checks. No intermediary.
          </p>
        </section>
      )}
      {screen === "onboard" &&
        onboardMode === "create" &&
        !mnemonicConfirmed && (
          <section className="page-section flow-section">
            <button
              className="back-link"
              onClick={() => setOnboardMode("choose")}
            >
              Back
            </button>
            <p className="eyebrow">BACKUP YOUR WALLET</p>
            <h2>Write down your recovery phrase</h2>
            <p className="intro">
              These words are the only way to recover your bitcoin. Keep them
              offline and never share them.
            </p>
            <div className="warning">
              <span>
                <strong>Important</strong>
                <br />
                Anyone with this phrase can spend your bitcoin.
              </span>
            </div>
            <div className="mnemonic-grid">
              {mnemonic.split(" ").map((word, i) => (
                <div className="mnemonic-word" key={i}>
                  <span>{i + 1}</span>
                  {word}
                </div>
              ))}
            </div>
            <button className="plain-button" onClick={() => void copyPhrase()}>
              {phraseCopied ? "Copied" : "Copy recovery phrase"}
            </button>
            <button
              className="primary-button"
              onClick={() => setMnemonicConfirmed(true)}
            >
              I saved my phrase
            </button>
          </section>
        )}
      {screen === "onboard" &&
        onboardMode === "create" &&
        mnemonicConfirmed && (
          <section className="page-section flow-section">
            <button
              className="back-link"
              onClick={() => setMnemonicConfirmed(false)}
            >
              Back
            </button>
            <p className="eyebrow">SECURE THIS DEVICE</p>
            <h2>Create a password</h2>
            <p className="intro">
              This password encrypts your recovery phrase on this browser. It
              cannot recover a lost phrase.
            </p>
            <PasswordFields
              password={password}
              confirmPassword={confirmPassword}
              setPassword={setPassword}
              setConfirmPassword={setConfirmPassword}
            />
            {error && <div className="error-box">{error}</div>}
            <button
              className="primary-button"
              onClick={() => void finishSetup(mnemonic)}
            >
              Open my wallet
            </button>
          </section>
        )}
      {screen === "onboard" && onboardMode === "import" && (
        <section className="page-section flow-section">
          <button
            className="back-link"
            onClick={() => setOnboardMode("choose")}
          >
            Back
          </button>
          <p className="eyebrow">RESTORE WALLET</p>
          <h2>Enter your recovery phrase</h2>
          <p className="intro">
            Paste the words copied from your old wallet, or type them with
            spaces between each word.
          </p>
          <textarea
            value={importText}
            onChange={e => {
              setImportText(e.target.value);
              setError(null);
            }}
            placeholder="word1 word2 word3 ..."
            autoComplete="off"
          />
          <button className="plain-button" onClick={() => void pastePhrase()}>
            Paste from clipboard
          </button>
          <PasswordFields
            password={password}
            confirmPassword={confirmPassword}
            setPassword={setPassword}
            setConfirmPassword={setConfirmPassword}
          />
          {error && <div className="error-box">{error}</div>}
          <button className="primary-button" onClick={finishImport}>
            Restore wallet
          </button>
        </section>
      )}
      {screen === "unlock" && (
        <section className="page-section centered-page">
          <p className="eyebrow">WELCOME BACK</p>
          <h2>Unlock your wallet</h2>
          <p className="intro">
            Your encrypted wallet is stored locally on this browser.
          </p>
          <input
            className="standalone-input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && void unlock()}
            placeholder="Password"
            autoFocus
          />
          {error && <div className="error-box">{error}</div>}
          <button className="primary-button" onClick={() => void unlock()}>
            Unlock wallet
          </button>
          <button className="button-quiet" onClick={resetWallet}>
            Use a different wallet
          </button>
        </section>
      )}
      {screen === "dashboard" && account && (
        <section className="dashboard page-section">
          <h1 className="wallet-title">Lectra Wallet</h1>
          <div className="balance-card">
            <div className="balance-label">
              {balanceLoading ? "UPDATING" : "TOTAL BALANCE"}
              <button
                className="refresh"
                onClick={() => void refreshBalance()}
                aria-label="Refresh balance"
              >
                Refresh
              </button>
            </div>
            <div className="balance-value">
              {balanceSats === null ? "0" : satsToBtcString(balanceSats)}{" "}
              <small>BTC</small>
            </div>
            <div className="balance-fiat">
              {btcPrice && balanceSats !== null
                ? `USD ${((balanceSats / 100_000_000) * btcPrice).toFixed(2)}`
                : "USD 0.00"}
            </div>
            <button
              className="card-menu"
              aria-label="Wallet options"
              onClick={() =>
                setNotice("Use Lock or Reset from the bottom navigation.")
              }
            >
              Options
            </button>
          </div>
          <div className="price-strip">
            <span>BTC/USD</span>
            <strong>
              {btcPrice === null
                ? (priceError ?? "Loading price...")
                : `$${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            </strong>
          </div>
          <button
            className="stats-button"
            onClick={() => setStatsOpen(!statsOpen)}
          >
            {statsOpen ? "Hide stats" : "Stats"}
          </button>
          {statsOpen && (
            <div className="stats-panel">
              {startOfDayValue === null ||
              balanceSats === null ||
              btcPrice === null ? (
                <p>Stats will appear after the balance and price load.</p>
              ) : (
                <>
                  <p>Start of day: ${startOfDayValue.toFixed(2)}</p>
                  <p>
                    Current value: $
                    {((balanceSats / 100_000_000) * btcPrice).toFixed(2)}
                  </p>
                </>
              )}
            </div>
          )}
          <div className="action-grid-four">
            <button className="round-action" onClick={() => setTab("send")}>
              <span>Send</span>
            </button>
            <button className="round-action" onClick={() => setTab("receive")}>
              <span>Receive</span>
            </button>
            <button className="round-action" onClick={() => void copyAddress()}>
              <span>Copy</span>
            </button>
            <button
              className="round-action"
              onClick={() => void refreshBalance()}
            >
              <span>Refresh</span>
            </button>
          </div>
          {tab === "receive" && (
            <div className="wallet-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">RECEIVE BITCOIN</p>
                  <h3>Your address</h3>
                </div>
                <span className="verified">
                  <i /> {network}
                </span>
              </div>
              <div className="qr-box">
                <QRCodeSVG value={account.address} size={176} />
              </div>
              <div className="address-line">
                <span>{account.address}</span>
                <button
                  onClick={() => void copyAddress()}
                  aria-label="Copy address"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <button className="plain-button" onClick={rotateReceiveAddress}>
                Generate a new receiving address
              </button>
              <a
                className="explorer-link"
                href={getBtcExplorerAddressUrl(account.address)}
                target="_blank"
                rel="noreferrer"
              >
                View on block explorer
              </a>
              <p className="helper">
                Only send Bitcoin on the Bitcoin {network} network to this
                address.
              </p>
            </div>
          )}
          {tab === "send" && (
            <div className="wallet-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">SEND BITCOIN</p>
                  <h3>Make a payment</h3>
                </div>
              </div>
              <label>
                RECIPIENT ADDRESS
                <input
                  value={sendTo}
                  onChange={e => setSendTo(e.target.value)}
                  placeholder={network === "mainnet" ? "bc1..." : "tb1..."}
                  autoComplete="off"
                />
              </label>
              <button
                className="plain-button"
                onClick={() => setScannerOpen(true)}
              >
                Scan recipient QR
              </button>
              {scannerOpen && (
                <div className="scanner-box">
                  <video ref={videoRef} autoPlay muted playsInline />
                  <button
                    className="plain-button"
                    onClick={() => setScannerOpen(false)}
                  >
                    Close scanner
                  </button>
                </div>
              )}
              <label>
                AMOUNT
                <div className="amount-input">
                  <input
                    value={sendAmount}
                    onChange={e => setSendAmount(e.target.value)}
                    placeholder="0.00000000"
                    inputMode="decimal"
                  />
                  <span>BTC</span>
                </div>
              </label>
              <label>
                FEE RATE
                <select
                  value={feeTarget}
                  onChange={e =>
                    setFeeTarget(e.target.value as FeePolicy["target"])
                  }
                >
                  <option value="economy">Economy</option>
                  <option value="normal">Normal</option>
                  <option value="priority">Priority</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {feeTarget === "custom" && (
                <input
                  value={customFee}
                  onChange={e => setCustomFee(e.target.value)}
                  placeholder="sat/vB"
                  inputMode="numeric"
                />
              )}
              <p className="helper">
                The transaction is built and reviewed before signing or
                broadcast.
              </p>
              {sendError && <div className="error-box">{sendError}</div>}
              {sendResult && (
                <div className="success-box">
                  Transaction broadcast.
                  <br />
                  <a
                    href={getBtcExplorerTxUrl(sendResult)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction
                  </a>
                </div>
              )}
              {pendingPlan && (
                <div className="warning">
                  <strong>Review transaction</strong>
                  <br />
                  Send {satsToBtcString(pendingPlan.amountSats)} BTC
                  <br />
                  Fee: {pendingPlan.feeSats.toLocaleString()} sats at{" "}
                  {pendingPlan.feeRate} sat/vB
                  <br />
                  Estimated size: {pendingPlan.estimatedVBytes} vB
                  <br />
                  Inputs: {pendingPlan.inputs.length} · Change:{" "}
                  {satsToBtcString(pendingPlan.changeSats)} BTC
                  <button
                    className="primary-button"
                    onClick={() => void signAndBroadcast()}
                    disabled={sending}
                  >
                    {sending ? "Signing…" : "Sign and broadcast"}
                  </button>
                  <textarea
                    value={hardwarePsbt}
                    onChange={e => setHardwarePsbt(e.target.value)}
                    placeholder="Paste a signed hardware-wallet PSBT"
                  />
                  <button
                    className="plain-button"
                    onClick={() => void importHardwarePsbt()}
                    disabled={sending}
                  >
                    Verify PSBT and broadcast
                  </button>
                  <button
                    className="button-quiet"
                    onClick={() => setPendingPlan(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}{" "}
              {!pendingPlan && (
                <button
                  className="primary-button"
                  onClick={() => void prepareSend()}
                  disabled={sending}
                >
                  {sending ? "Building…" : "Review transaction"}
                </button>
              )}
            </div>
          )}
          <button
            className="history-row"
            onClick={() => {
              setHistoryOpen(!historyOpen);
              if (!historyOpen) void refreshHistory();
            }}
          >
            <span>History</span>
            <span>{historyOpen ? "Close" : "Open"}</span>
          </button>
          {historyOpen && (
            <div className="history-panel">
              {history.length ? (
                history.map(entry => (
                  <p key={entry.txid}>
                    <strong>{entry.direction}</strong>{" "}
                    {satsToBtcString(entry.amountSats)} BTC ·{" "}
                    {entry.confirmations
                      ? `${entry.confirmations} confirmations`
                      : "unconfirmed"}
                    <br />
                    <a
                      href={getBtcExplorerTxUrl(entry.txid)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entry.txid.slice(0, 18)}…
                    </a>
                  </p>
                ))
              ) : (
                <p>No indexed transactions found.</p>
              )}
            </div>
          )}
          <p className="empty-history">
            {history.length
              ? `${history.length} transaction${history.length === 1 ? "" : "s"} indexed.`
              : "Your transactions will appear here."}
          </p>
          <div className="security-card">
            <strong>Self-custody wallet</strong>
            <p>
              Your keys are encrypted locally and never sent to a server. Review
              every transaction before signing.
            </p>
          </div>
          <nav className="bottom-nav">
            <button className="nav-active">Home</button>
            <button onClick={() => setTab("receive")}>Wallet</button>
            <button onClick={lock}>Lock</button>
            <button onClick={resetWallet}>Reset</button>
          </nav>
        </section>
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)}>Close</button>
        </div>
      )}
    </main>
  );
}

function PasswordFields({
  password,
  confirmPassword,
  setPassword,
  setConfirmPassword,
}: PasswordFieldsProps) {
  return (
    <div className="password-fields">
      <label>
        PASSWORD
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="At least 10 characters"
        />
      </label>
      <label>
        CONFIRM PASSWORD
        <input
          type="password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          placeholder="Repeat your password"
        />
      </label>
    </div>
  );
}
