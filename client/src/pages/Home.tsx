import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { QRCodeSVG } from "qrcode.react";
import { btcStringToSats, fetchBtcBalanceSats, satsToBtcString, sendBtc } from "@/lib/btc";
import { accountFromMnemonicBtc, createNewMnemonic, isValidMnemonic } from "@/lib/btcWallet";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { clearStoredWallet, hasStoredWallet, loadEncryptedWallet, saveEncryptedWallet } from "@/lib/storage";
import { getBtcExplorerAddressUrl, getBtcExplorerTxUrl, getBtcNetwork } from "@/lib/btcNetwork";

type Screen = "loading" | "onboard" | "unlock" | "dashboard";
type OnboardMode = "choose" | "create" | "import";
type Tab = "receive" | "send";
type PasswordFieldsProps = { password: string; confirmPassword: string; setPassword: (value: string) => void; setConfirmPassword: (value: string) => void };

export default function Home() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [onboardMode, setOnboardMode] = useState<OnboardMode>("choose");
  const [tab, setTab] = useState<Tab>("receive");
  const [account, setAccount] = useState<ReturnType<typeof accountFromMnemonicBtc> | null>(null);
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
  const [startOfDayValue, setStartOfDayValue] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const network = getBtcNetwork();

  useEffect(() => setScreen(hasStoredWallet() ? "unlock" : "onboard"), []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 3200); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;
    const reader = new BrowserMultiFormatReader();
    let stopped = false;
    void reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, videoRef.current, (result) => {
      if (stopped || !result) return;
      const text = result.getText().trim();
      const address = text.replace(/^bitcoin:/i, "").split(/[?&]/)[0];
      setSendTo(address);
      setScannerOpen(false);
      setTab("send");
      setNotice("QR code scanned");
    }).catch(() => setNotice("Camera access was unavailable. You can paste an address instead."));
    return () => { stopped = true; videoRef.current?.srcObject && (videoRef.current.srcObject as MediaStream).getTracks().forEach((track) => track.stop()); };
  }, [scannerOpen]);

  const refreshBalance = useCallback(async (address: string) => {
    setBalanceLoading(true);
    try { setBalanceSats(await fetchBtcBalanceSats(address)); } catch { setNotice("Could not refresh the balance right now."); } finally { setBalanceLoading(false); }
  }, []);
  useEffect(() => { if (account) refreshBalance(account.address); }, [account, refreshBalance]);
  const loadPrice = useCallback(async () => {
    try {
      const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
      if (!response.ok) throw new Error("Price unavailable");
      const data = await response.json() as { bitcoin?: { usd?: number } };
      if (typeof data.bitcoin?.usd !== "number") throw new Error("Price unavailable");
      setBtcPrice(data.bitcoin.usd); setPriceError(null);
    } catch { setPriceError("Price unavailable"); }
  }, []);
  useEffect(() => {
    void loadPrice();
    let fallbackTimer: number | undefined;
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade");
      socket.onmessage = (event) => {
        try {
          const trade = JSON.parse(event.data) as { p?: string };
          const price = Number(trade.p);
          if (Number.isFinite(price)) { setBtcPrice(price); setPriceError(null); }
        } catch { setPriceError("Price unavailable"); }
      };
      socket.onerror = () => { fallbackTimer = window.setInterval(() => void loadPrice(), 1000); };
      socket.onclose = () => { if (fallbackTimer === undefined) fallbackTimer = window.setInterval(() => void loadPrice(), 1000); };
    } catch { fallbackTimer = window.setInterval(() => void loadPrice(), 1000); }
    return () => { socket?.close(); if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer); };
  }, [loadPrice]);
  useEffect(() => {
    if (!account || balanceSats === null || btcPrice === null) return;
    const day = new Date().toISOString().slice(0, 10);
    const key = `bitcoin-wallet:stats:${account.address}:${day}`;
    const currentBtc = balanceSats / 100_000_000;
    const currentValue = currentBtc * btcPrice;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const snapshot = JSON.parse(saved) as { value?: number };
        if (typeof snapshot.value === "number") { setStartOfDayValue(snapshot.value); return; }
      } catch { localStorage.removeItem(key); }
    }
    localStorage.setItem(key, JSON.stringify({ value: currentValue, btc: currentBtc, price: btcPrice, createdAt: Date.now() }));
    setStartOfDayValue(currentValue);
  }, [account, balanceSats, btcPrice]);

  function loadAccount(phrase: string) { setAccount(accountFromMnemonicBtc(phrase)); }
  function startCreate() { setMnemonic(createNewMnemonic()); setMnemonicConfirmed(false); setOnboardMode("create"); setError(null); }
  async function finishSetup(phrase: string) {
    setError(null);
    if (password.length < 8) return setError("Choose a password with at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords don't match.");
    saveEncryptedWallet(await encryptSecret(phrase.trim(), password));
    loadAccount(phrase.trim()); setPassword(""); setConfirmPassword(""); setImportText(""); setScreen("dashboard");
  }
  function normalizePhrase(value: string) { return value.replace(/\b(?:word\s*)?\d{1,2}[.)]?\s*/gi, " ").replace(/[,\n\r\t]+/g, " ").trim().replace(/\s+/g, " "); }
  function finishImport() { setError(null); const phrase = normalizePhrase(importText); if (!isValidMnemonic(phrase)) return setError("Enter a valid 12, 15, 18, 21, or 24-word recovery phrase."); void finishSetup(phrase); }
  async function unlock() {
    setError(null); const blob = loadEncryptedWallet(); if (!blob) return setScreen("onboard");
    try { loadAccount(await decryptSecret(blob, password)); setPassword(""); setScreen("dashboard"); } catch { setError("Incorrect password."); }
  }
  function lock() { setAccount(null); setBalanceSats(null); setScreen("unlock"); }
  function resetWallet() {
    if (!window.confirm("Remove this wallet from this browser? You will need your recovery phrase to restore it.")) return;
    clearStoredWallet(); setAccount(null); setBalanceSats(null); setOnboardMode("choose"); setScreen("onboard");
  }
  async function handleSend() {
    setSendError(null); setSendResult(null); if (!account) return;
    const sats = btcStringToSats(sendAmount);
    if (!sendTo.trim()) return setSendError("Enter a recipient address.");
    const expectedPrefix = network === "mainnet" ? "bc1" : "tb1";
    if (!sendTo.trim().toLowerCase().startsWith(expectedPrefix)) return setSendError(`Use a Bitcoin ${network} address beginning with ${expectedPrefix}.`);
    if (!Number.isSafeInteger(sats) || sats <= 0) return setSendError("Enter a valid amount greater than 0.");
    setSending(true);
    try { const txid = await sendBtc(account, sendTo.trim(), sats); setSendResult(txid); setSendTo(""); setSendAmount(""); void refreshBalance(account.address); }
    catch (e: any) { setSendError(e?.message || "Transaction failed."); } finally { setSending(false); }
  }
  async function copyAddress() { if (!account) return; await navigator.clipboard.writeText(account.address); setCopied(true); setNotice("Address copied"); window.setTimeout(() => setCopied(false), 1800); }
  async function copyPhrase() {
    if (!mnemonic) return;
    await navigator.clipboard.writeText(mnemonic);
    setPhraseCopied(true);
    setNotice("Recovery phrase copied");
    window.setTimeout(() => setPhraseCopied(false), 1800);
  }
  async function pastePhrase() {
    try {
      const text = await navigator.clipboard.readText();
      setImportText(normalizePhrase(text));
      setError(null);
      setNotice("Recovery phrase pasted");
    } catch {
      setError("Clipboard access was blocked. Paste the phrase into the field manually.");
    }
  }
  function comingSoon(label: string) { setNotice(`${label} is coming soon in this prototype.`); }

  if (screen === "loading") return null;
  return <main className="app-shell">
    <header className="topbar">
      <div className="top-controls"><button className="coin-toggle" aria-label="Bitcoin network">Bitcoin</button></div>
      {screen === "dashboard" ? <button className="settings-button" onClick={lock}>Lock</button> : <div className="brand">Lectra Wallet</div>}
    </header>

    {screen === "onboard" && onboardMode === "choose" && <section className="welcome page-section"><p className="eyebrow">PRIVATE BY DEFAULT</p><h1>Your bitcoin.<br /><span>Your keys.</span></h1><p className="intro">A simple self-custody wallet for Bitcoin mainnet. Your recovery phrase stays encrypted in this browser.</p><button className="primary-button" onClick={startCreate}>Create new wallet</button><button className="button-quiet" onClick={() => { setOnboardMode("import"); setError(null); }}>Restore existing wallet</button><p className="fine-print">No account. No identity checks. No intermediary.</p></section>}

    {screen === "onboard" && onboardMode === "create" && !mnemonicConfirmed && <section className="page-section flow-section"><button className="back-link" onClick={() => setOnboardMode("choose")}>Back</button><p className="eyebrow">BACKUP YOUR WALLET</p><h2>Write down your recovery phrase</h2><p className="intro">These words are the only way to recover your bitcoin. Keep them offline and never share them.</p><div className="warning"><span><strong>Important</strong><br />Anyone with this phrase can spend your bitcoin.</span></div><div className="mnemonic-grid">{mnemonic.split(" ").map((word, i) => <div className="mnemonic-word" key={i}><span>{i + 1}</span>{word}</div>)}</div><button className="plain-button" onClick={() => void copyPhrase()}>{phraseCopied ? "Copied" : "Copy recovery phrase"}</button><button className="primary-button" onClick={() => setMnemonicConfirmed(true)}>I saved my phrase</button></section>}

    {screen === "onboard" && onboardMode === "create" && mnemonicConfirmed && <section className="page-section flow-section"><button className="back-link" onClick={() => setMnemonicConfirmed(false)}>Back</button><p className="eyebrow">SECURE THIS DEVICE</p><h2>Create a password</h2><p className="intro">This password encrypts your recovery phrase on this browser. It cannot recover a lost phrase.</p><PasswordFields password={password} confirmPassword={confirmPassword} setPassword={setPassword} setConfirmPassword={setConfirmPassword} />{error && <div className="error-box">{error}</div>}<button className="primary-button" onClick={() => void finishSetup(mnemonic)}>Open my wallet</button></section>}

    {screen === "onboard" && onboardMode === "import" && <section className="page-section flow-section"><button className="back-link" onClick={() => setOnboardMode("choose")}>Back</button><p className="eyebrow">RESTORE WALLET</p><h2>Enter your recovery phrase</h2><p className="intro">Paste the words copied from your old wallet, or type them with spaces between each word.</p><textarea value={importText} onChange={(e) => { setImportText(e.target.value); setError(null); }} placeholder="word1 word2 word3 ..." autoComplete="off" /><button className="plain-button" onClick={() => void pastePhrase()}>Paste from clipboard</button><PasswordFields password={password} confirmPassword={confirmPassword} setPassword={setPassword} setConfirmPassword={setConfirmPassword} />{error && <div className="error-box">{error}</div>}<button className="primary-button" onClick={finishImport}>Restore wallet</button></section>}

    {screen === "unlock" && <section className="page-section centered-page"><p className="eyebrow">WELCOME BACK</p><h2>Unlock your wallet</h2><p className="intro">Your encrypted wallet is stored locally on this browser.</p><input className="standalone-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void unlock()} placeholder="Password" autoFocus />{error && <div className="error-box">{error}</div>}<button className="primary-button" onClick={() => void unlock()}>Unlock wallet</button><button className="button-quiet" onClick={resetWallet}>Use a different wallet</button></section>}

      {screen === "dashboard" && account && <section className="dashboard page-section"><h1 className="wallet-title">Lectra Wallet</h1><div className="balance-card"><div className="balance-label">{balanceLoading ? "UPDATING" : "TOTAL BALANCE"}<button className="refresh" onClick={() => void refreshBalance(account.address)} aria-label="Refresh balance">Refresh</button></div><div className="balance-value">{balanceSats === null ? "0" : satsToBtcString(balanceSats)} <small>BTC</small></div><div className="balance-fiat">USD 0.00</div><button className="card-menu" aria-label="Wallet options">Options</button></div><div className="price-strip"><span>BTC/USD</span><strong>{btcPrice === null ? (priceError ?? "Loading price...") : `$${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</strong></div><button className="stats-button" onClick={() => setStatsOpen(!statsOpen)}>{statsOpen ? "Hide stats" : "Stats"}</button>{statsOpen && <div className="stats-panel">{startOfDayValue === null || balanceSats === null || btcPrice === null ? <p>Stats will appear after the balance and price load.</p> : (() => { const currentValue = (balanceSats / 100_000_000) * btcPrice; const change = currentValue - startOfDayValue; const percent = startOfDayValue === 0 ? 0 : (change / startOfDayValue) * 100; return <><p>Start of day: ${startOfDayValue.toFixed(2)}</p><p>Current value: ${currentValue.toFixed(2)}</p><p>{change < 0 ? "Lost" : "Gained"}: ${Math.abs(change).toFixed(2)}</p><p>That's about {percent >= 0 ? "+" : ""}{percent.toFixed(2)}%</p></>; })()}</div>}<div className="action-grid-four"><button className="round-action" onClick={() => setTab("send")}><span>Send</span></button><button className="round-action" onClick={() => setTab("receive")}><span>Receive</span></button><button className="round-action" onClick={() => void copyAddress()}><span>Copy</span></button><button className="round-action" onClick={() => void refreshBalance(account.address)}><span>Refresh</span></button></div>

      {tab === "receive" && <div className="wallet-panel"><div className="panel-heading"><div><p className="eyebrow">RECEIVE BITCOIN</p><h3>Your address</h3></div><span className="verified"><i /> {network}</span></div><div className="qr-box"><QRCodeSVG value={account.address} size={176} /></div><div className="address-line"><span>{account.address}</span><button onClick={() => void copyAddress()} aria-label="Copy address">{copied ? "Copied" : "Copy"}</button></div><a className="explorer-link" href={getBtcExplorerAddressUrl(account.address)} target="_blank" rel="noreferrer">View on block explorer</a><p className="helper">Only send Bitcoin on the Bitcoin {network} network to this address.</p></div>}
      {tab === "send" && <div className="wallet-panel"><div className="panel-heading"><div><p className="eyebrow">SEND BITCOIN</p><h3>Make a payment</h3></div></div><label>RECIPIENT ADDRESS<input value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder={network === "mainnet" ? "bc1..." : "tb1..."} autoComplete="off" /></label><button className="plain-button" onClick={() => setScannerOpen(true)}>Scan recipient QR</button>{scannerOpen && <div className="scanner-box"><video ref={videoRef} autoPlay muted playsInline /><button className="plain-button" onClick={() => setScannerOpen(false)}>Close scanner</button></div>}<label>AMOUNT<div className="amount-input"><input value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} placeholder="0.00000000" inputMode="decimal" /><span>BTC</span></div></label><p className="helper">The network fee is estimated automatically and deducted from your balance.</p>{sendError && <div className="error-box">{sendError}</div>}{sendResult && <div className="success-box">Transaction broadcast.<br /><a href={getBtcExplorerTxUrl(sendResult)} target="_blank" rel="noreferrer">View transaction</a></div>}<button className="primary-button" onClick={() => void handleSend()} disabled={sending}>{sending ? "Broadcasting…" : "Send bitcoin"}</button></div>}

      <button className="history-row" onClick={() => setNotice("Transaction history will appear here after the first indexed transaction.")}><span>History</span><span>Open</span></button><p className="empty-history">Your transactions will appear here.</p><div className="security-card"><strong>Self-custody wallet</strong><p>Your keys are encrypted locally and never sent to a server.</p></div><nav className="bottom-nav"><button className="nav-active">Home</button><button onClick={() => setTab("receive")}>Wallet</button><button onClick={lock}>Lock</button><button onClick={resetWallet}>Reset</button></nav></section>}
    {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice(null)}>Close</button></div>}
  </main>;
}

function PasswordFields({ password, confirmPassword, setPassword, setConfirmPassword }: PasswordFieldsProps) { return <div className="password-fields"><label>PASSWORD<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /></label><label>CONFIRM PASSWORD<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat your password" /></label></div>; }
