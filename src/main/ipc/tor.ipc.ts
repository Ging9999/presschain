import { ipcMain } from 'electron'
import { getTorStatus, startTor, stopTor } from '../tor'

/** Tor status IPC — the renderer polls this from the sidebar TorStatus widget. */
export function registerTorIpc(): void {
  ipcMain.handle('tor:getStatus', () => getTorStatus())

  // Tear down and re-establish the Tor process to obtain a fresh circuit.
  ipcMain.handle('tor:newCircuit', async () => {
    try {
      stopTor()
      await startTor()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
