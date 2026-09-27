# PressChain

**PressChain is a censorship-resistant journalism archive.** It lets writers publish
articles that cannot be quietly deleted by any single party. Content is encrypted on your
own device, stored on IPFS, and anchored by an on-chain pointer on the Base Sepolia
blockchain. Every network request — publishing, browsing, and reading — is routed over the
Tor network, so using PressChain leaves no direct trace back to your IP address.

PressChain is self-custodial and serverless. There is no company account to suspend and no
central database to seize or subpoena. You hold your own wallet and your own decryption
keys. Nobody — not a host, not a government, not the PressChain contributors — can read or
remove your work on your behalf. Removal is possible only through a transparent, on-chain
community process.

---

## How it works

1. **Encrypt.** When you publish, the article body is encrypted in the app with
   **AES‑256‑GCM** using a fresh random key generated per article. The plaintext never
   leaves your machine.
2. **Store on IPFS.** The ciphertext is uploaded to **IPFS** via Web3.Storage. IPFS returns
   a content identifier (CID) that addresses the encrypted blob.
3. **Register on-chain.** A pointer — the CID plus a SHA‑256 integrity hash of the
   ciphertext, along with the public title and summary — is registered in the
   `ArticleRegistry` smart contract on **Base Sepolia**. Your wallet address is recorded as
   the uploader.
4. **Community flagging.** Any wallet can flag an article once. When an article reaches the
   flag threshold (10), it is automatically hidden from the default browse view.
5. **Community removal (crypto-shredding).** Anyone can open a removal proposal, which
   starts a 3‑day vote. If it reaches the required votes, the on-chain CID pointer is
   cleared. Because the content was encrypted, deleting the key renders it permanently
   unreadable — "crypto-shredding." In this MVP, key deletion is **local only** (see
   Limitations).

## Privacy model

PressChain protects different things to different degrees. Be clear about what is and isn't
anonymous:

- **Your IP address is hidden.** All traffic — the Base Sepolia RPC and the IPFS
  gateway/upload — is intended to egress through the bundled Tor SOCKS proxy, so IPFS and
  RPC nodes do not see your real IP.
- **Article content is private.** Bodies are AES‑256‑GCM encrypted client-side. Only someone
  holding the per-article key can read the plaintext. Titles and summaries are **public** by
  design (they power the browse view) — do not put sensitive information in them.
- **Only you can decrypt your uploads.** The per-article key is stored locally, encrypted
  under your passphrase. It never leaves your device.
- **Your wallet address is a public pseudonym.** The uploader address is permanently visible
  on-chain. It is not linked to your real identity by PressChain, but it is a stable
  pseudonym: everything you publish from the same wallet is publicly linkable. Treat the
  wallet as a pen name, and consider using a fresh wallet for unrelated work.

## Limitations (MVP)

PressChain is an early MVP. Known gaps you should understand before relying on it:

- **No key sharing yet.** Only the original uploader holds the decryption key, so only the
  uploader can read an article. Sharing/readership keys are a planned v2 feature; today,
  other users see an "encrypted — you don't hold the key" message.
- **Crypto-shredding is local only.** A successful removal vote clears the on-chain CID
  pointer and deletes the key **on the uploader's device**. There is no guardian committee
  holding shared key custody yet, so removal cannot force-shred copies others may have
  retrieved. This is a deliberate MVP simplification.
- **Tor protects IP, not your pseudonym.** Tor hides your network location, but your wallet
  address remains a public on-chain pseudonym (see Privacy model).
- **Testnet only.** PressChain currently targets **Base Sepolia** (a testnet). Do not treat
  it as a production, high-assurance system.
- **Tor routing depends on the runtime path.** Node-side requests (RPC/IPFS `fetch`) must be
  explicitly routed through the SOCKS proxy; verify your build routes them before relying on
  IP privacy.

## Building

**Prerequisites:** Node 20+ (developed on Node 22), npm.

```bash
npm install          # install dependencies
npm run dev          # run the app in development
```

Package installable desktop apps into `release/`:

```bash
npm run dist:mac     # macOS  (.dmg, .zip — x64 + arm64)
npm run dist:win     # Windows (NSIS installer — x64 + ia32)
npm run dist:linux   # Linux  (.deb, .AppImage, .rpm)
npm run dist:all     # all three (needs the matching toolchains)
```

App icons are generated from `resources/icon.svg`:

```bash
npm run generate-icons
```

> **Tor bundling:** granax provisions the Tor daemon (fetched during install and cached in
> your app-data directory). The first launch may take ~15–30s while Tor bootstraps; later
> launches take ~2s.

## Getting testnet ETH

Publishing and flagging are on-chain actions on Base Sepolia and need a small amount of test
ETH for gas. Fund your PressChain wallet address (copy it from **Settings → Wallet**) from a
Base Sepolia faucet:

- https://docs.base.org/tools/network-faucets

## Contributing

Contributions are welcome. Please:

1. Open an issue describing the change before large PRs.
2. Keep the security model intact — never weaken encryption, CSP, `contextIsolation`,
   `sandbox`, or the Tor routing.
3. Run `npm run typecheck` and `npm run build` before submitting.
4. For contract changes, add tests under `contracts/test/` and keep them green
   (`npx hardhat test`).

PressChain is built with Electron + electron-vite, React, Tailwind CSS, ethers v6, Hardhat,
and granax.
