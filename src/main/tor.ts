import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { app, session } from 'electron'

/**
 * Launches the Tor daemon bundled with the app (the official Tor Expert Bundle,
 * staged under resources/tor/<platform>-<arch>/ by scripts/fetch-tor.ts). This
 * replaces the previous granax-managed approach, which did not provide working
 * Tor on Windows.
 */

export type TorState = 'starting' | 'ready' | 'error'

export interface TorStatus {
  state: TorState
  progress: number
}

const SOCKS_PORT = 19051
const CONTROL_PORT = 19052
const BOOTSTRAP_TIMEOUT_MS = 120_000

/** Map process.platform/arch to the bundled Tor resource dir (TEB naming). */
function torResourceDir(): string {
  const platform =
    process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'ia32' ? 'i686' : 'x86_64'
  return `${platform}-${arch}`
}

interface TorPaths {
  binary: string
  torDir: string
  geoip: string
  geoip6: string
}

function resolveTorPaths(): TorPaths {
  const dir = torResourceDir()
  // Production: extraResources copies resources/tor -> <resourcesPath>/tor.
  // Dev: read from the repo. Try a couple of roots so it works under electron-vite
  // dev and standalone harnesses.
  let base: string
  if (app.isPackaged) {
    base = join(process.resourcesPath, 'tor', dir)
  } else {
    const candidates = [
      join(app.getAppPath(), 'resources', 'tor', dir),
      join(process.cwd(), 'resources', 'tor', dir)
    ]
    base = candidates.find((c) => existsSync(join(c, 'tor'))) ?? candidates[0]
  }
  const torDir = join(base, 'tor')
  const binary = join(torDir, process.platform === 'win32' ? 'tor.exe' : 'tor')
  return { binary, torDir, geoip: join(base, 'data', 'geoip'), geoip6: join(base, 'data', 'geoip6') }
}

class TorManager extends EventEmitter {
  private state: TorState = 'starting'
  private progress = 0
  private message = 'Connecting to the Tor network…'
  private child: ChildProcess | null = null
  private timeoutTimer: NodeJS.Timeout | null = null
  private settled = false
  private proxyApplied = false
  private exitHookInstalled = false

  getTorStatus(): TorStatus {
    return { state: this.state, progress: this.progress }
  }

  getMessage(): string {
    return this.message
  }

  private setProgress(p: number): void {
    const next = Math.max(0, Math.min(100, Math.round(p)))
    if (next !== this.progress) {
      this.progress = next
      this.emit('progress', this.progress)
    }
  }

  private setState(s: TorState, message?: string): void {
    this.state = s
    if (message) this.message = message
    this.emit('state', this.getTorStatus())
  }

  /**
   * Start Tor and resolve once it is bootstrapped ('ready') or has failed
   * ('error'). Never rejects — callers act on getTorStatus().
   */
  startTor(): Promise<void> {
    if (this.child) return Promise.resolve()

    return new Promise<void>((resolve) => {
      const finish = (): void => {
        if (this.settled) return
        this.settled = true
        this.clearTimers()
        resolve()
      }

      this.settled = false
      this.setState('starting', 'Connecting to the Tor network…')
      this.setProgress(0)

      const paths = resolveTorPaths()
      if (!existsSync(paths.binary)) {
        this.handleError(
          new Error(
            `Bundled Tor binary not found at ${paths.binary}. Run "npm run fetch-tor" (dev) ` +
              `or verify the packaged resources.`
          )
        )
        return finish()
      }

      // chmod +x on macOS/Linux at first run if needed.
      if (process.platform !== 'win32') {
        try {
          chmodSync(paths.binary, 0o755)
        } catch {
          /* best effort */
        }
      }

      // Write a minimal torrc into the app's userData directory.
      const dataDir = join(app.getPath('userData'), 'tor')
      try {
        mkdirSync(dataDir, { recursive: true })
      } catch {
        /* exists */
      }
      const toTorPath = (p: string): string => p.replace(/\\/g, '/') // Tor prefers forward slashes
      const torrcPath = join(dataDir, 'torrc')
      const torrc = [
        `SocksPort ${SOCKS_PORT}`,
        `ControlPort ${CONTROL_PORT}`,
        'CookieAuthentication 1',
        `DataDirectory ${toTorPath(dataDir)}`,
        ...(existsSync(paths.geoip) ? [`GeoIPFile ${toTorPath(paths.geoip)}`] : []),
        ...(existsSync(paths.geoip6) ? [`GeoIPv6File ${toTorPath(paths.geoip6)}`] : []),
        'Log notice stdout',
        'AvoidDiskWrites 1'
      ].join('\n')
      try {
        writeFileSync(torrcPath, torrc)
      } catch (err) {
        this.handleError(err)
        return finish()
      }

      // Fail gracefully if Tor never bootstraps.
      this.timeoutTimer = setTimeout(() => {
        if (this.state !== 'ready') {
          this.handleError(new Error('Timed out waiting for Tor to bootstrap'))
          finish()
        }
      }, BOOTSTRAP_TIMEOUT_MS)

      let child: ChildProcess
      try {
        child = spawn(paths.binary, ['-f', torrcPath], {
          cwd: paths.torDir, // resolve sibling libs / pluggable transports
          env:
            process.platform === 'linux'
              ? { ...process.env, LD_LIBRARY_PATH: paths.torDir }
              : process.env,
          windowsHide: true
        })
      } catch (err) {
        this.handleError(err)
        return finish()
      }
      this.child = child
      this.installExitHook()

      // Parse the bootstrap phase percentage from Tor's log output.
      const handleLine = (line: string): void => {
        const m = /Bootstrapped (\d+)%/.exec(line)
        if (m) {
          this.setProgress(parseInt(m[1], 10))
          if (this.progress >= 100) {
            this.markReady()
            finish()
          }
        }
      }
      const feed = (buf: Buffer): void => {
        buf
          .toString('utf8')
          .split('\n')
          .forEach((l) => {
            const t = l.trim()
            if (t) handleLine(t)
          })
      }
      child.stdout?.on('data', feed)
      child.stderr?.on('data', feed)

      child.on('error', (err) => {
        this.handleError(err)
        finish()
      })
      child.on('exit', (code) => {
        if (this.state !== 'ready') {
          this.handleError(new Error(`Tor exited with code ${code}`))
          finish()
        }
      })
    })
  }

  private markReady(): void {
    if (this.state === 'ready') return
    this.clearTimers()
    this.setProgress(100)
    this.setState('ready', 'Tor Connected')
    this.applyProxy()
  }

  /**
   * Route Chromium traffic through the Tor SOCKS proxy. (Node-side traffic —
   * ethers/IPFS — is proxied separately in torTransport.ts.)
   */
  private applyProxy(): void {
    if (this.proxyApplied) return
    this.proxyApplied = true
    const proxy = `socks5://127.0.0.1:${SOCKS_PORT}`
    try {
      app.commandLine.appendSwitch('proxy-server', proxy)
      void session.defaultSession.setProxy({ proxyRules: proxy })
    } catch (err) {
      console.error('[tor] failed to apply proxy switch', err)
    }
  }

  private handleError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[tor] error:', msg)
    this.clearTimers()
    if (this.state !== 'ready') {
      this.setState('error', 'Tor Error')
    }
  }

  private installExitHook(): void {
    if (this.exitHookInstalled) return
    this.exitHookInstalled = true
    process.once('exit', () => {
      try {
        this.child?.kill()
      } catch {
        /* ignore */
      }
    })
  }

  private clearTimers(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }
  }

  /** Terminate the Tor process on app quit. */
  stopTor(): void {
    this.clearTimers()
    try {
      this.child?.kill()
    } catch (err) {
      console.error('[tor] error during shutdown', err)
    }
    this.child = null
  }
}

export const torManager = new TorManager()

export const startTor = (): Promise<void> => torManager.startTor()
export const getTorStatus = (): TorStatus => torManager.getTorStatus()
export const stopTor = (): void => torManager.stopTor()
