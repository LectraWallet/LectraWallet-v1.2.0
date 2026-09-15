export interface BrowserSecurityState {
  safe: boolean;
  reason?: string;
}

const LOCK_AFTER_HIDDEN_MS = 60_000;

export function inspectBrowserSecurity(): BrowserSecurityState {
  if (!window.isSecureContext)
    return {
      safe: false,
      reason: "This wallet requires a secure HTTPS browser context.",
    };
  if (window.top !== window.self)
    return {
      safe: false,
      reason: "This wallet cannot run inside an embedded frame.",
    };
  return { safe: true };
}

export function installBrowserSecurityGuards(
  onLock: (reason: string) => void
): () => void {
  let hiddenTimer: number | undefined;
  const hidden = () => {
    if (document.visibilityState !== "hidden") return;
    hiddenTimer = window.setTimeout(
      () => onLock("Wallet locked after one minute in the background."),
      LOCK_AFTER_HIDDEN_MS
    );
  };
  const visible = () => {
    if (hiddenTimer !== undefined) window.clearTimeout(hiddenTimer);
    hiddenTimer = undefined;
  };
  const onVisibility = () =>
    document.visibilityState === "hidden" ? hidden() : visible();
  const onPageHide = () => onLock("Wallet locked because the page was hidden.");
  const onViolation = (event: SecurityPolicyViolationEvent) => {
    if (
      event.effectiveDirective === "script-src" ||
      event.effectiveDirective === "connect-src"
    ) {
      onLock("Wallet locked after a browser security-policy violation.");
    }
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (
          node instanceof HTMLScriptElement &&
          node.src &&
          new URL(node.src, location.href).origin !== location.origin
        ) {
          onLock(
            "Wallet locked after an unexpected external script was added."
          );
          return;
        }
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("securitypolicyviolation", onViolation);
  return () => {
    visible();
    observer.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("securitypolicyviolation", onViolation);
  };
}

export async function writeSafeClipboard(value: string): Promise<void> {
  if (!window.isSecureContext || !navigator.clipboard?.writeText)
    throw new Error("Clipboard access is unavailable in this browser.");
  await navigator.clipboard.writeText(value);
}
