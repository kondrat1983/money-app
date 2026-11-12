// Generates PWA icons (icon-192/512, icon-maskable-512, apple-touch-icon 180) into public/
// using only Node built-ins. Pixel-art amber coin on near-black. Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BG = [0x14, 0x11, 0x0f]
const hex = (h) => [h >> 16, (h >> 8) & 255, h & 255]
const RIM = hex(0x7a5a1c)
const FACE = hex(0xd0a03a)
const HI = hex(0xe9cc7a)
const SHADE = hex(0xa67c24)
const INK = hex(0x1a1208)
const GRID = 32 // art is a 32x32 pixel grid scaled to any size

// Colour of one art cell (cx, cy in 0..31) for a coin of radius r cells, or null for ground.
function cell(cx, cy, r) {
  const dx = cx + 0.5 - GRID / 2
  const dy = cy + 0.5 - GRID / 2
  const d = Math.hypot(dx, dy)
  if (d > r) return null
  if (d > r - 1.5) return RIM
  // emblem: vertical bar with two crossbars, scaled with the coin
  const u = Math.round((dx / r) * 10)
  const v = Math.round((dy / r) * 10)
  const bar = Math.abs(u) <= 1 && Math.abs(v) <= 6
  const cross = Math.abs(v + 2) <= 0 || Math.abs(v - 2) <= 0 ? Math.abs(u) <= 5 : false
  if (bar || cross) return INK
  if (Math.abs(d - (r - 4)) < 0.7) return SHADE
  if (dx + dy < -r * 0.9 && d > r - 4) return HI
  return FACE
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, radiusCells) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const c = cell(Math.floor((x / size) * GRID), Math.floor((y / size) * GRID), radiusCells)
      const [r, g, b] = c ?? BG
      const p = row + 1 + x * 4
      raw[p] = r
      raw[p + 1] = g
      raw[p + 2] = b
      raw[p + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const outDir = join(root, 'public')
mkdirSync(outDir, { recursive: true })
// Coin radius in art cells. Maskable icons keep the emblem inside the central 80% safe zone.
const outputs = [
  ['icon-192.png', 192, 13],
  ['icon-512.png', 512, 13],
  ['icon-maskable-512.png', 512, 10],
  ['apple-touch-icon.png', 180, 12],
]
for (const [name, size, r] of outputs) {
  writeFileSync(join(outDir, name), png(size, r))
  console.log(`wrote public/${name}`)
}
