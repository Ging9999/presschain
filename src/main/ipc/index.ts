import { registerTorIpc } from './tor.ipc'
import { registerWalletIpc } from './wallet.ipc'
import { registerUploadIpc } from './upload.ipc'
import { registerReadIpc } from './read.ipc'

/** Register every IPC handler. Call once, after the app is ready. */
export function registerIpcHandlers(): void {
  registerTorIpc()
  registerWalletIpc()
  registerUploadIpc()
  registerReadIpc()
}
