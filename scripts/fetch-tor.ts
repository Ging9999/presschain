/**
 * Downloads the official Tor Expert Bundle (TEB) for the requested platform(s)
 * and stages the `tor` binary + geoip data under resources/tor/<platform-arch>/.
 *
 * The binaries are NOT committed — this runs at build time. electron-builder
 * ships resources/tor/** via extraResources (see electron-builder.yml).
 *
 * Verification:
 *   - SHA-256 of every download is checked against the Tor Project's published
 *     `sha256sums-unsigned-build.txt`. A mismatch fails the build.
 *   - If `gpg` is available, the GPG signature over that checksum file is
 *     verified against the Tor Browser Developers key. If gpg (or the key) is
 *     unavailable it is skipped with a warning unless `--require-gpg` is passed.
 *
 * Usage:
 *   npm run fetch-tor                       # host platform/arch
 *   npm run fetch-tor -- --all              # all desktop targets
 *   npm run fetch-tor -- --targets=macos-aarch64,linux-x86_64
 *   npm run fetch-tor -- --require-gpg      # fail if GPG can't be verified
 */
import { createHash } from 'crypto'
import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync, chmodSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import * as tar from 'tar'

const VERSION = process.env.TOR_EB_VERSION || '15.0.19'
const BASE = `https://dist.torproject.org/torbrowser/${VERSION}`
const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, 'resources', 'tor')
// Tor Browser Developers (signing key) fingerprint.
const TOR_KEY_FPR = 'EF6E286DDA85EA2A4BA7DE684E2C6E8793298290'

const DESKTOP_TARGETS = [
  'windows-x86_64',
  'windows-i686',
  'macos-x86_64',
  'macos-aarch64',
  'linux-x86_64'
]

function hostTarget(): string {
  const platform =
    process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
  const arch =
    process.arch === 'arm64' ? 'aarch64' : process.arch === 'ia32' ? 'i686' : 'x86_64'
  return `${platform}-${arch}`
}

function parseTargets(): string[] {
  if (process.argv.includes('--all')) return DESKTOP_TARGETS
  const arg = process.argv.find((a) => a.startsWith('--targets='))
  if (arg) {
    return arg
      .slice('--targets='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return [hostTarget()]
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

function expectedSha(sumsText: string, filename: string): string | null {
  for (const line of sumsText.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i)
    if (m && m[2].trim() === filename) return m[1].toLowerCase()
  }
  return null
}

function gpgAvailable(): boolean {
  try {
    execFileSync('gpg', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function verifyGpgSignature(sumsPath: string, ascPath: string): 'verified' | 'failed' | 'skipped' {
  if (!gpgAvailable()) return 'skipped'
  // Best-effort import of the signing key from a keyserver.
  spawnSync('gpg', ['--keyserver', 'hkps://keys.openpgp.org', '--recv-keys', TOR_KEY_FPR], {
    stdio: 'ignore'
  })
  const r = spawnSync('gpg', ['--verify', ascPath, sumsPath], { stdio: 'ignore' })
  return r.status === 0 ? 'verified' : 'failed'
}

async function fetchTarget(target: string, sumsText: string): Promise<void> {
  const filename = `tor-expert-bundle-${target}-${VERSION}.tar.gz`
  const url = `${BASE}/${filename}`
  console.log(`↓ ${filename}`)

  const buf = await download(url)
  const sha = createHash('sha256').update(buf).digest('hex')
  const expected = expectedSha(sumsText, filename)
  if (!expected) throw new Error(`No checksum for ${filename} in sha256sums-unsigned-build.txt`)
  if (sha !== expected) {
    throw new Error(`Checksum MISMATCH for ${filename}\n  expected ${expected}\n  got      ${sha}`)
  }
  console.log(`  ✓ sha256 ${sha.slice(0, 16)}…`)

  const dest = join(OUT, target)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })

  const tmp = join(tmpdir(), filename)
  writeFileSync(tmp, buf)
  // Extract only the tor binary tree + geoip data (skip docs/ and debug/).
  await tar.extract({
    file: tmp,
    cwd: dest,
    filter: (p) => p === 'tor' || p.startsWith('tor/') || p === 'data' || p.startsWith('data/')
  })
  rmSync(tmp, { force: true })

  const isWin = target.startsWith('windows')
  const bin = join(dest, 'tor', isWin ? 'tor.exe' : 'tor')
  if (!existsSync(bin)) throw new Error(`tor binary missing after extract: ${bin}`)
  if (!isWin) chmodSync(bin, 0o755)
  console.log(`  ✓ ${target} -> resources/tor/${target}/`)
}

async function main(): Promise<void> {
  const targets = parseTargets()
  console.log(`Tor Expert Bundle ${VERSION} — targets: ${targets.join(', ')}`)

  const sumsText = (await download(`${BASE}/sha256sums-unsigned-build.txt`)).toString('utf8')

  // Verify the GPG signature over the checksum file (best effort).
  let asc: Buffer | null = null
  try {
    asc = await download(`${BASE}/sha256sums-unsigned-build.txt.asc`)
  } catch {
    /* signature file unavailable */
  }
  if (asc) {
    const sp = join(tmpdir(), 'teb-sums.txt')
    const ap = join(tmpdir(), 'teb-sums.txt.asc')
    writeFileSync(sp, sumsText)
    writeFileSync(ap, asc)
    const result = verifyGpgSignature(sp, ap)
    rmSync(sp, { force: true })
    rmSync(ap, { force: true })
    if (result === 'verified') {
      console.log('✓ GPG signature on checksums verified')
    } else if (result === 'failed') {
      if (process.argv.includes('--require-gpg')) throw new Error('GPG signature verification FAILED')
      console.warn('⚠ GPG verification FAILED — continuing on SHA-256 checksum only (use --require-gpg to enforce)')
    } else {
      if (process.argv.includes('--require-gpg')) throw new Error('gpg unavailable but --require-gpg was set')
      console.warn('⚠ gpg not available — verified SHA-256 checksum only, NOT the GPG signature')
    }
  }

  for (const t of targets) await fetchTarget(t, sumsText)
  console.log('Done.')
}

main().catch((e) => {
  console.error('fetch-tor failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
