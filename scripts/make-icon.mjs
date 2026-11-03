/**
 * Generates resources/icon.png (1024×1024): the Cartographer diamond on a dark
 * rounded square. Pure Node (zlib), no image libraries, so the icon is
 * reproducible from source. Run: node scripts/make-icon.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 1024
const SS = 3 // supersampling per axis, for smooth edges

const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t))
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

const BG = hex('#0b0f19')
const BG2 = hex('#18213a')
const CYAN = hex('#22d3ee')
const VIOLET = hex('#a78bfa')

/** Coverage-weighted color of one supersample at (x, y) in [0,1]². */
function sample(x, y) {
  // Rounded square background (corner radius 22%).
  const r = 0.22
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0)
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0)
  if (dx * dx + dy * dy > r * r) return null // transparent
  let color = mix(BG, BG2, (x + y) / 2)

  // Outer diamond (|x-.5| + |y-.5| <= 0.34), gradient fill.
  const d = Math.abs(x - 0.5) + Math.abs(y - 0.5)
  if (d <= 0.34) color = mix(CYAN, VIOLET, (x * 0.6 + y * 0.4))
  // Inner cut-out diamond, to read as a map marker / node.
  if (d <= 0.15) color = mix(BG, BG2, (x + y) / 2)
  // Small center diamond.
  if (d <= 0.07) color = mix(CYAN, VIOLET, 0.5)
  return color
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let py = 0; py < SIZE; py++) {
  raw[py * (SIZE * 4 + 1)] = 0 // filter: none
  for (let px = 0; px < SIZE; px++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample((px + (sx + 0.5) / SS) / SIZE, (py + (sy + 0.5) / SS) / SIZE)
        if (!c) continue
        r += c[0]; g += c[1]; b += c[2]; a += 1
      }
    }
    const o = py * (SIZE * 4 + 1) + 1 + px * 4
    const n = SS * SS
    raw[o] = a ? Math.round(r / a) : 0
    raw[o + 1] = a ? Math.round(g / a) : 0
    raw[o + 2] = a ? Math.round(b / a) : 0
    raw[o + 3] = Math.round((a / n) * 255)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`wrote ${out} (${(png.length / 1024).toFixed(0)} KB)`)
