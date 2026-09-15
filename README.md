# Lectra Wallet

Lectra Wallet is a Bitcoin-only, browser-based self-custody wallet prototype. It derives a native SegWit Bitcoin address from a BIP-39 recovery phrase, encrypts the phrase locally in the browser, displays the current BTC/USD price, supports receiving and sending native Bitcoin, and includes recovery-phrase copy/paste and camera QR scanning.

## Important warning

This is a prototype and has not been independently audited. Do not use it with meaningful funds. The recovery phrase controls the wallet: anyone who obtains it can spend the bitcoin, and losing it can permanently prevent recovery. Review the transaction-building, address-validation, dependency, browser-security, and backup behavior before using real funds.

Always test with a small amount first. Use only native Bitcoin mainnet when sending to a mainnet `bc1...` address. Do not send wrapped BTC, tokens on another chain, or testnet coins to a mainnet address.

## Browser-only self-custody

The wallet is designed to run on the client side. The recovery phrase is encrypted with a password and stored in the browser's local storage. The hosting provider does not receive the phrase through the wallet application, but the security of the device, browser, dependencies, deployment account, and hosting configuration still matters.

The wallet is not a hosted custodian. Vercel serves the frontend; it does not hold the user's bitcoin. Anyone deploying a modified build should review the source and deployment output before trusting it.

## Run locally

Requirements:

- Node.js 22 or later
- pnpm

Install dependencies and start the development server:

```bash
pnpm install
pnpm dev
```

Run the checks:

```bash
pnpm check
pnpm build
```

## Deploy your own copy through Vercel

1. Fork or clone this repository.
2. Sign in to [Vercel](https://vercel.com/).
3. Select **Add New Project** and import the GitHub repository.
4. Vercel should detect the Vite project automatically.
5. Use these build settings if Vercel asks:
   - Install command: `pnpm install`
   - Build command: `pnpm build`
   - Output configuration: use the project defaults; the included build produces the frontend and server bundle.
6. Deploy the project.
7. Open the HTTPS deployment URL and verify the source, domain, and browser permissions before creating or restoring a wallet.

For a production deployment, pin dependencies, enable GitHub branch protection, review Vercel project members and tokens, and use a custom domain with HTTPS. Never put a recovery phrase, password, private key, or wallet export in Vercel environment variables, GitHub issues, logs, screenshots, or commits.

## Current features

- Bitcoin mainnet wallet flow
- BIP-39 recovery phrase generation and restore
- Local AES-GCM encryption of the recovery phrase
- Native SegWit address derivation
- Receive address and QR code
- Camera QR scanner for Bitcoin recipients
- BTC/USD live price display with fallback polling
- Balance refresh and plain prototype interface
- Daily local performance snapshot and Stats view

## Limitations

The project is not production-ready wallet software. It does not replace an audited hardware wallet or established wallet application. Transaction fees, UTXO selection, broadcast behavior, public API availability, address validation, browser storage, and device security require further review and testing.

## License

The repository currently uses the MIT license metadata from the project template. Review and update the license before distributing a production wallet.
