# PressChain — Known Issues & Work Backlog

Status after Prompts 1–6: the app builds, type-checks, packages into installers, and the
full UI + wallet + encryption/keystore layers are verified. **However, several items must be
addressed before it delivers on its stated privacy guarantees or works end-to-end against a
live network.** This document is the hand-off backlog. Items are grouped by severity with
file references and suggested actions.

Legend: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low / Future

---

## 🔴 Critical — the app does not yet do what it claims

### C1. RPC and IPFS traffic bypass Tor — ✅ MOSTLY FIXED
- **Was:** `ethers.JsonRpcProvider` and the IPFS gateway `fetch()` ran on Node/undici, which
  ignores the Chromium `proxy-server` switch, so RPC and IPFS traffic egressed over the
  clearnet despite comments claiming "goes through Tor".
- **Fixed:** Added `src/main/services/torTransport.ts` — a shared `SocksProxyAgent`
  (`socks5h://127.0.0.1:19051`, remote DNS), `torFetch`, and a single `getProxiedProvider()`
  ethers provider built from a proxied `FetchRequest`. `wallet.ts`/`contract.ts` now use the
  one shared proxied provider; `ipfs.ts` reads via `torFetch` and uploads with a Tor-backed
  `fetch`. All paths **fail closed** (throw) if Tor isn't ready — verified: `torFetch`,
  `getBalance`, and `getTorAgent` all refuse to connect directly. Misleading comments fixed.
- **✅ Confirmed live (Windows):** once C2 landed (bundled Tor), `torFetch` to
  `check.torproject.org/api/ip` returned `{ "IsTor": true, "IP": <a Tor exit node> }` — the
  Node-side traffic really does exit through Tor now. (macOS/Linux still worth spot-checking.)
- **Residual — C1a:** the **w3up ucanto service connection** (built in `create()` and used by
  `login()`/`createSpace()`/`addSpace()` and capability invocations in `setupIPFS`/`initIPFS`)
  still uses w3up's default global fetch and is **not** routed through Tor. Only the gateway
  reads and the upload data path are covered. **Action:** pass a custom `serviceConf` to
  `create()` whose channels use a SOCKS-backed `fetch` (see the TODO in `ipfs.ts`).

### C2. Tor does not run on Windows; bundling strategy — ✅ FIXED (Windows verified)
- **Was:** granax's Tor download was macOS/Linux only, so Windows had no `tor.exe` and Tor
  always errored; the "first-run download" UI was vestigial (granax downloads at install time).
- **Fixed:**
  - `scripts/fetch-tor.ts` downloads the official **Tor Expert Bundle** per platform/arch from
    the Tor Project dist, verifies the **SHA-256 checksum** (and the **GPG signature** over the
    checksum file when `gpg` is available — verified in practice), and stages
    `tor` + geoip under `resources/tor/<platform>-<arch>/`. Binaries are **not committed**
    (`resources/tor` is git-ignored); the `dist:*` scripts fetch the right targets first.
  - `electron-builder.yml` ships `resources/tor/**` via `extraResources` (on disk, executable,
    outside the asar). Confirmed present in a packaged build at
    `<resourcesPath>/tor/<platform>-<arch>/tor/tor.exe`.
  - `src/main/tor.ts` was rewritten to spawn the bundled binary directly (no granax): resolves
    the path from `process.resourcesPath` (prod) or the repo (dev), writes a minimal torrc
    (SocksPort 19051, ControlPort + cookie auth, DataDirectory in userData, GeoIP files),
    parses `Bootstrapped N%` from stdout into the existing `tor:progress` events, and
    `chmod +x`es the binary on macOS/Linux. Handles win/mac(x64+arm64)/linux paths.
  - The granax dependency is removed; the vestigial "Downloading Tor…" UI/event is gone, and
    the copy is now "Connecting to the Tor network…" with the bar driven by real bootstrap %.
- **Verified:** on **Windows** the bundled tor.exe (v0.4.9.11) bootstraps to **100%** in ~12s
  and TorStatus goes green; the packaged build stages the binary at the production path.
- **⚠️ Unverified: macOS and Linux runtime** — no access to those machines in this
  environment. The path/arch mapping and `chmod`/`LD_LIBRARY_PATH` handling are implemented but
  not runtime-tested there; validate on a Mac and a Linux box. Also, launching the fully
  packaged `.exe` (vs. dev path) to confirm Tor starts was not run — only binary placement was
  confirmed.

### C3. Contract is not deployed — `deployment.json` is a zero-address placeholder
- **What:** `src/main/deployment.json` still contains `0x0000…0000`, so all on-chain calls fail.
- **Done so far:**
  - **Runtime guard added** (`contract.ts`): `getContract()` now calls `assertDeployed()` and
    throws *"Contract not deployed — run the deploy script …"* instead of hitting the zero
    address cryptically. Exposed `isContractDeployed()`. Verified: `listArticles`/`flagArticle`
    reject with the clear message.
  - **Verification wired:** `hardhat.config.ts` has BaseScan (`customChains`) config; the deploy
    script prints the ready `npx hardhat verify --network baseSepolia <address>` command.
    Needs `BASESCAN_API_KEY` in `contracts/.env` (documented in `.env.example`).
  - Deploy + post-deploy pipeline confirmed correct earlier: `deploy.ts` writes
    `src/main/deployment.json`, `export-abi.ts` refreshes `src/main/ArticleRegistry.abi.json`
    (both chained by `npm run deploy:base-sepolia`).
- **⛔ Blocked — needs the human:** the actual deploy could **not** be run: no funded
  `DEPLOYER_PRIVATE_KEY` is configured in `contracts/.env`, and a private key must not be
  handled here. Until it's deployed, Browse/upload/read/flag surface the "not deployed" guard
  error (by design) rather than live data.
- **To finish:** put a funded key in `contracts/.env` → `npm run deploy:base-sepolia` →
  (optional) `npx hardhat verify …` → then Browse loads live data and `npm run smoke-e2e` can go
  green.

### C4. Ciphertext integrity is never verified on read — ✅ FIXED
- **Was:** `src/main/ipc/read.ipc.ts` fetched and decrypted without comparing the blob's hash
  to the on-chain `ciphertextHash`, so a hostile gateway could serve altered bytes undetected.
- **Fixed:** Added `getCiphertextHash(articleId)` to `contract.ts` and
  `ciphertextHashMatches()` (constant-time, `timingSafeEqual`, hex/0x/case-normalised) to
  `encryption.ts`. `article:read` now computes SHA-256 over the exact ciphertext span
  uploadArticle hashed and compares it to the on-chain value **before** decrypting; on a
  mismatch it returns `{ error: 'INTEGRITY_FAILURE', … }` and does not decrypt. Verified with
  a round-trip (passes + decrypts) and a one-byte tamper (returns INTEGRITY_FAILURE rather
  than a raw crypto error).

### C5. Governance was trivially Sybil-attackable — ✅ FIXED (MVP mitigation)
- **Was:** flagging and removal were free (5 free votes removed any article instantly).
- **Fixed** in `ArticleRegistry.sol`:
  - Flagging and removal voting each require a **refundable stake**, so identities cost money
    and cost scales linearly per sub-wallet.
  - Removal is a **two-sided, time-boxed vote**. Winners reclaim their stake **plus a pro-rata
    share of the losing side's forfeited stake**; losers forfeit. Execution can't happen until
    the voting window closes (no instant rush) and no single wallet can decide it.
  - Flag stakes are refundable on withdraw-after-cooldown or on an aligned removal, and
    forfeited (via a flag-epoch bump) when a removal is rejected.
  - Thresholds/stakes are **guardian-configurable** (`setParams`, placeholder for the H2
    multisig) instead of hardcoded tiny constants.
  - On-chain account-age checks aren't practical (no Solidity opcode for EOA age/nonce) — we
    rely on the stake, documented in the contract.
  - App wired: flag/propose send stakes; `Read.tsx` shows the stake amount + refund/forfeit
    rule before confirming; `gov:getParams` exposes the values.
  - **13 Hardhat tests pass**, incl. staking, refund-on-aligned, forfeit-on-misaligned, and two
    Sybil demos (a single address can't remove alone + cost scales; defenders defeat a takedown
    and take the attacker's forfeited stake).
- **⚠️ Still MVP, not Kleros:** a capital-dominant attacker who out-stakes defenders can still
  win. This raises the bar (cost + forfeiture risk), it doesn't make takedown impossible.
- **⛔ Redeploy pending** (blocked by C3 / funded key): the new ABI is exported to the app, but
  the contract must be redeployed for the live app to use it.

---

## 🟠 High

### H1. Only the uploader could read an article — ✅ FIXED (envelope encryption)
- **Was:** the per-article key stayed on the uploader's device; everyone else hit `KEY_NOT_FOUND`.
- **Fixed** with envelope (ECIES-style) encryption:
  - Every wallet has a deterministic **X25519 keypair** derived from its signing key
    (`identity.ts`); the public key is shown in Settings to share.
  - On upload, the author may add **recipient public keys**; the per-article AES key is wrapped
    to each (`nacl.box`, ephemeral-static) and stored in the **IPFS envelope — never on-chain**
    (`envelope.ts`, `upload.ipc.ts`). Confirmed by grep: on-chain calls carry only
    cid/ciphertextHash/title/summary + stakes, never a key.
  - A labelled **"Publish publicly"** option stores the AES key in the clear (world-readable,
    irreversible) with a clear warning.
  - On read, the key is resolved from public → local keystore → recipient unwrap, then the C4
    integrity check runs, then decrypt. `KEY_NOT_FOUND` now distinguishes **"not a recipient"**
    from **"no key at all"**.
- **Verified** (offline crypto harness): recipient B decrypts, author reads, non-recipient C
  gets "not a recipient", public is readable by any wallet, and the envelope doesn't disturb the
  on-chain ciphertext hash. `npm run typecheck` clean; production build green.
- **Note:** X25519 keys are derived from the signing key via domain-separated SHA-256 (one-way,
  never used for signing). Recipient key exchange is manual (copy/paste public keys) for the MVP.

### H2. "Crypto-shredding" is local-only
- **What:** A successful removal vote clears the on-chain CID and deletes the **uploader's**
  local key. There is no guardian committee / shared key custody, so removal cannot shred
  copies anyone else fetched. `shamirs-secret-sharing` was installed for this but is unused.
- **Action:** Implement the guardian/threshold-key model (Shamir split of article keys across
  guardians) or clearly scope removal as "delist + local shred" in the product.

### H3. Passphrase hash is unsalted SHA-256
- **What:** `src/main/services/keystore.ts` stores `passHash = sha256(passphrase)` to
  validate unlock. Unsalted single-round SHA-256 is weak (rainbow-tableable if the store
  leaks).
- **Action:** Validate the passphrase by attempting the scrypt-KEK decrypt instead, or store
  a salted `scrypt`/`argon2` verifier. (The article keys themselves are already scrypt-KEK
  wrapped — good — this is only the verifier.)

### H4. No error handling on `article:list`
- **What:** `src/main/ipc/wallet.ipc.ts` `article:list` does `return listArticles(...)` with
  no try/catch, so an RPC failure rejects the IPC and can surface as an unhandled error.
- **Action:** Wrap in try/catch and return a structured error the Browse page already knows
  how to render.

### H5. No code signing / notarization
- **What:** `mac.notarize: false`, Windows build is unsigned. Users get "unidentified
  developer" / SmartScreen warnings; auto-update won't verify.
- **Action:** Obtain Apple Developer + Windows code-signing certs and wire them into the build
  (`signtoolOptions`, notarize creds) for release channels.

### H6. Auto-updater is configured but not implemented
- **What:** `electron-builder.yml` has a `publish: github` block (with placeholder
  `YOUR_GITHUB_USERNAME`), but there is **no `electron-updater` code** in `src/main`. Nothing
  actually checks for or applies updates.
- **Action:** Add `electron-updater`, wire `autoUpdater` events, and set the real repo owner.

---

## 🟡 Medium

### M1. Hardcoded RPC URLs, duplicated, and a new provider per call — ✅ FIXED
- Resolved as part of C1: `torTransport.ts` owns the RPC URL (env-overridable via
  `BASE_SEPOLIA_RPC_URL`), chain id, and a single cached provider reused by both `wallet.ts`
  and `contract.ts`.

### M2. Upload progress phases are cosmetic
- `src/renderer/src/pages/Upload.tsx` cycles "Encrypting → Uploading → Registering" on a
  timer; the backend does it atomically. Emit real per-phase IPC progress events from
  `article:upload` if accurate progress matters.

### M3. electron-store `encryptionKey`s are hardcoded (obfuscation only)
- `'presschain-local-vault'` / `'presschain-keystore-v1'` are in source, so at-rest
  encryption is only obfuscation. The wallet (passphrase-encrypted) and article keys
  (scrypt-KEK) are fine; note this limitation and consider Electron `safeStorage` (OS
  keychain) for the master material.

### M4. Wallet-locked detection is string-matching
- Several places detect the locked state via `message.includes('locked')`
  (`Browse.tsx`, `Upload.tsx`, `Read.tsx`, `ErrorCallout.ts`). Use a typed error code from
  the main process instead of substring matching.

### M5. No automated tests outside the contract
- Only `contracts/test` has tests. Encryption/keystore/wallet/ipfs and the React pages were
  verified with throwaway harnesses; commit real unit tests (Vitest for services + renderer,
  keep the Hardhat suite).

### M6. `getArticles` pagination is unbounded per call
- The Solidity view builds seven arrays in a loop; very large `limit` values could hit RPC
  response/gas caps. Cap `limit` on-chain or in the IPC layer.

### M7. `read` fetches from IPFS before checking the local key
- `article:read` downloads ciphertext, then discovers `KEY_NOT_FOUND`. Check key ownership
  first to avoid a wasted (de-anonymizing) network fetch for articles you can't read anyway.

---

## ⚪ Low / Future / Polish

- **L1. Dev mock ships in the bundle.** `src/renderer/src/lib/devMock.ts` is guarded by
  `import.meta.env.DEV` (never runs in prod) but is still bundled. Confirm tree-shaking or
  strip it from production builds.
- **L2. Icons are placeholder-quality.** Hand-authored `resources/icon.svg`. Get a designed
  logo before release.
- **L3. Placeholder metadata.** `publish.owner: YOUR_GITHUB_USERNAME`, copyright year, app
  homepage — fill in for release.
- **L4. No article caching.** Browse refetches on every mount; add a cache/stale-while-
  revalidate.
- **L5. Accessibility.** No focus management, ARIA, or keyboard-nav audit on the wizard/
  modals.
- **L6. CSP allows `'unsafe-inline'` for styles** (and `'unsafe-eval'` in dev). Fine for MVP;
  tighten with hashes/nonces if hardening further.
- **L7. Splash/CSP hard-coded colors** duplicate the design tokens; centralize if it grows.

---

## End-to-end smoke test & measured latencies

A single scripted smoke test — `scripts/smoke-e2e.ts`, run with `npm run smoke-e2e` — exercises
the full path over Tor against the live chain + IPFS: encrypt → IPFS upload → on-chain register
→ list → fetch → C4 integrity check → decrypt → flag (confirms `flagCount` increments). It
reads secrets from `.env` (git-ignored; template in `.env.example`) and **writes to the live
Base Sepolia testnet** (spends test ETH). It refuses to send anything and prints exactly what's
missing unless all prerequisites are present:

- `DEPLOYER_PRIVATE_KEY` — a funded Base Sepolia wallet key
- a deployed contract (`src/main/deployment.json` with a real address — blocked by **C3**)
- `W3UP_PROOF` — a base64 w3up delegation for your space
- bundled Tor (`npm run fetch-tor`)

**Status:** written and wired; the prerequisite-validation + `.env` plumbing were verified (it
runs, loads `.env`, and fails closed with clear guidance). The **green end-to-end run has not
been executed** — it needs the funded key + deployed contract + w3up account, which are the
human's to provide.

### Measured latencies (fill in the rest from a real `smoke-e2e` run)

| Step | Value | Source |
|---|---|---|
| Tor bootstrap (5% → 100%) | **~12 s** (one Windows dev sample; varies with network) | measured (C2 run) |
| Tor exit confirmed | `check.torproject.org` → `IsTor: true` | measured (C1 run) |
| IPFS upload (w3up) | _pending live run_ | — |
| IPFS fetch (w3s.link gateway) | _pending live run_ | — |
| RPC register (tx confirm) | _pending live run_ | — |
| RPC flag (tx confirm) | _pending live run_ | — |

> Do not guess these — run `npm run smoke-e2e` with prerequisites set and paste the printed
> `TIMINGS_JSON` here.

## Still not verified end-to-end (needs live environment / other machines)

1. The green `smoke-e2e` run itself (see above) — blocked by **C3** + funded key + w3up account.
2. Launching the **packaged** app (vs. dev) and confirming the full flow from the installer —
   only code/dep presence and Tor-binary placement were confirmed.
3. macOS / Linux runtime for the bundled Tor (C2) — no access to those machines here.

**Suggested next steps:** C3 (deploy) → run `npm run smoke-e2e` green and record timings → then
C5 (governance) and C1a (proxy the w3up service connection).
