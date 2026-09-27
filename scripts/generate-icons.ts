/**
 * Generates all platform app icons from resources/icon.svg using sharp.
 *
 *   macOS  -> resources/icons/icon.icns  (16,32,64,128,256,512,1024)
 *   Windows-> resources/icons/icon.ico   (16,32,48,64,128,256)
 *   Linux  -> resources/icons/icon.png   (512)
 *
 * sharp only rasterizes PNGs, so the .ico and .icns container formats are
 * assembled here (both support embedded PNG images on modern OSes).
 *
 * Run:  npm run generate-icons
 */
import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'resources', 'icon.svg')
const OUT_DIR = path.join(ROOT, 'resources', 'icons')

async function png(size: number): Promise<Buffer> {
  return sharp(SRC, { density: 384 }).resize(size, size, { fit: 'contain' }).png().toBuffer()
}

/** Pack PNG buffers into a Windows .ico (PNG-in-ICO, Vista+). */
function buildIco(images: { size: number; data: Buffer }[]): Buffer {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const entries: Buffer[] = []
  let offset = 6 + count * 16
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 => 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1) // height
    e.writeUInt8(0, 2) // color palette
    e.writeUInt8(0, 3) // reserved
    e.writeUInt16LE(1, 4) // color planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

/** Pack PNG buffers into a macOS .icns (PNG entries, OS X 10.7+). */
function buildIcns(images: { type: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = []
  for (const { type, data } of images) {
    const head = Buffer.alloc(8)
    head.write(type, 0, 4, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    chunks.push(head, data)
  }
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

// OSType codes for PNG-based icns entries.
const ICNS_TYPES: Record<number, string> = {
  16: 'icp4',
  32: 'icp5',
  64: 'icp6',
  128: 'ic07',
  256: 'ic08',
  512: 'ic09',
  1024: 'ic10'
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const icoSizes = [16, 32, 48, 64, 128, 256]
  const icnsSizes = [16, 32, 64, 128, 256, 512, 1024]
  const allSizes = Array.from(new Set([...icoSizes, ...icnsSizes])).sort((a, b) => a - b)

  const buffers = new Map<number, Buffer>()
  for (const size of allSizes) {
    const data = await png(size)
    buffers.set(size, data)
    fs.writeFileSync(path.join(OUT_DIR, `icon-${size}.png`), data)
  }

  // Windows .ico
  fs.writeFileSync(
    path.join(OUT_DIR, 'icon.ico'),
    buildIco(icoSizes.map((size) => ({ size, data: buffers.get(size)! })))
  )

  // macOS .icns
  fs.writeFileSync(
    path.join(OUT_DIR, 'icon.icns'),
    buildIcns(icnsSizes.map((size) => ({ type: ICNS_TYPES[size], data: buffers.get(size)! })))
  )

  // Linux .png (512) — also refresh the app window icon used by electron-vite.
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), buffers.get(512)!)
  fs.writeFileSync(path.join(ROOT, 'resources', 'icon.png'), buffers.get(512)!)

  console.log('Generated icons in resources/icons/: icon.ico, icon.icns, icon.png (+ PNG sizes)')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
