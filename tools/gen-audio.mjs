// Procedural audio asset generator — synthesizes all SFX + the music loop and
// writes real 16-bit PCM .wav files to public/audio/. Zero dependencies.
// Run: npm run gen:assets
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 44100
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio')
mkdirSync(OUT, { recursive: true })

// Deterministic PRNG so regenerated assets are reproducible
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const buf = (sec) => new Float32Array(Math.ceil(sec * SR))
const TAU = Math.PI * 2

// Chamberlin state-variable filter; returns per-sample processor
function svf(fc, q, mode = 'lp') {
  let low = 0, band = 0
  return (x, fcNow = fc) => {
    const f = 2 * Math.sin(Math.PI * Math.min(fcNow, SR * 0.22) / SR)
    low += f * band
    const high = x - low - q * band
    band += f * high
    return mode === 'lp' ? low : mode === 'bp' ? band : high
  }
}

// Additive "music box / celesta" pluck written additively into b (wraps for loops)
function celesta(b, t0, freq, vel, rnd = Math.random, wrap = false) {
  const partials = [
    [1.0, 1.0, 2.6],
    [3.01, 0.22, 9.0],
    [5.4, 0.07, 22.0],
  ]
  const det = 1 + (rnd() - 0.5) * 0.0015
  const dur = 1.6
  const n0 = Math.floor(t0 * SR)
  const N = Math.floor(dur * SR)
  for (const [ratio, amp, decay] of partials) {
    const w = (TAU * freq * det * ratio) / SR
    let ph = rnd() * TAU
    for (let i = 0; i < N; i++) {
      const t = i / SR
      const env = Math.min(t / 0.004, 1) * Math.exp(-t * decay)
      const idx = wrap ? (n0 + i) % b.length : n0 + i
      if (idx >= b.length && !wrap) break
      b[idx] += Math.sin(ph) * env * amp * vel
      ph += w
    }
  }
}

function normalize(b, peak = 0.85) {
  let m = 0
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]))
  if (m > 0) { const g = peak / m; for (let i = 0; i < b.length; i++) b[i] *= g }
  return b
}

function writeWav(name, channels, peak = 0.85, sr = SR) {
  const chans = Array.isArray(channels) ? channels : [channels]
  // joint normalize so stereo balance is preserved
  let m = 0
  for (const c of chans) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]))
  const g = m > 0 ? peak / m : 1
  const n = chans[0].length, nc = chans.length
  const data = new Int16Array(n * nc)
  for (let i = 0; i < n; i++)
    for (let c = 0; c < nc; c++)
      data[i * nc + c] = Math.max(-32768, Math.min(32767, Math.round(chans[c][i] * g * 32767)))
  const bytes = new Uint8Array(44 + data.length * 2)
  const dv = new DataView(bytes.buffer)
  const str = (off, s) => { for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i) }
  str(0, 'RIFF'); dv.setUint32(4, 36 + data.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true)
  dv.setUint16(22, nc, true); dv.setUint32(24, sr, true)
  dv.setUint32(28, sr * nc * 2, true); dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true)
  str(36, 'data'); dv.setUint32(40, data.length * 2, true)
  bytes.set(new Uint8Array(data.buffer), 44)
  writeFileSync(join(OUT, name), bytes)
  console.log(`  wrote ${name} (${(bytes.length / 1024).toFixed(1)} kB)`)
}

/** halve sample rate with a 2-tap average (content is low-passed already) */
function decimate2(b) {
  const out = new Float32Array(Math.floor(b.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = (b[i * 2] + b[i * 2 + 1]) * 0.5
  return out
}

// ---------------------------------------------------------------- SFX

function genDrop() {
  const b = buf(0.16)
  let ph = 0
  const lp = svf(900, 0.9)
  const rnd = mulberry32(11)
  for (let i = 0; i < b.length; i++) {
    const t = i / SR
    const f = 420 * Math.pow(130 / 420, Math.min(t / 0.1, 1))
    ph += (TAU * f) / SR
    const body = Math.sin(ph) * Math.min(t / 0.003, 1) * Math.exp(-t * 26)
    const thump = lp((rnd() * 2 - 1) * Math.exp(-t * 90)) * 1.4
    b[i] = body + thump * 0.5
  }
  writeWav('drop.wav', b, 0.7)
}

function genMerge(name, k, dur, seed) {
  const b = buf(dur)
  const rnd = mulberry32(seed)
  const bp = svf(400, 1.6, 'bp')
  let ph = 0, ph2 = 0
  for (let i = 0; i < b.length; i++) {
    const t = i / SR
    const u = t / dur
    // squelch: bandpass noise sweeping up
    const fc = (300 + 1600 * Math.pow(u, 0.6)) * k
    const squelch = bp((rnd() * 2 - 1), fc) * Math.exp(-t * (14 / dur) * 0.45) * 2.2
    // bloop: rising sine with vibrato
    const f = (170 + 290 * Math.pow(u, 0.8)) * k * (1 + 0.02 * Math.sin(TAU * 9 * t))
    ph += (TAU * f) / SR
    const bell = Math.sin(Math.PI * Math.min(u * 1.6, 1))
    const bloop = Math.sin(ph) * bell * 0.9
    // sub thump for weight
    ph2 += (TAU * 70 * k) / SR
    const sub = Math.sin(ph2) * Math.exp(-t * 18) * (k < 1 ? 0.8 : 0.3)
    b[i] = squelch * 0.5 + bloop + sub
  }
  writeWav(name, b, 0.8)
}

function genPopTiny() {
  const b = buf(0.07)
  let ph = 0
  for (let i = 0; i < b.length; i++) {
    const t = i / SR
    const f = 820 * Math.pow(300 / 820, Math.min(t / 0.05, 1))
    ph += (TAU * f) / SR
    b[i] = Math.sin(ph) * Math.min(t / 0.002, 1) * Math.exp(-t * 60)
  }
  writeWav('pop.wav', b, 0.55)
}

function genSparkle() {
  const b = buf(1.4)
  const rnd = mulberry32(77)
  const notes = [1046.5, 1318.5, 1568, 2093, 2637] // C6 E6 G6 C7 E7
  notes.forEach((f, i) => celesta(b, i * 0.065, f, 0.7 - i * 0.06, rnd))
  writeWav('sparkle.wav', b, 0.6)
}

function genFanfare() {
  const b = buf(2.2)
  const rnd = mulberry32(99)
  const seq = [[0, 523.25], [0.12, 659.26], [0.24, 784], [0.42, 1046.5], [0.42, 659.26], [0.42, 784]]
  for (const [t, f] of seq) celesta(b, t, f, 0.8, rnd)
  celesta(b, 0.66, 1318.5, 0.5, rnd)
  writeWav('fanfare.wav', b, 0.75)
}

function genLegend() {
  const b = buf(3.2)
  const rnd = mulberry32(123)
  const roll = [523.25, 784, 1046.5, 1318.5, 1568, 2093]
  roll.forEach((f, i) => celesta(b, i * 0.09, f, 0.85 - i * 0.05, rnd))
  // add9 chord swell
  const chord = [261.63, 329.63, 392, 587.33]
  for (const f of chord) {
    let ph = rnd() * TAU
    for (let i = 0; i < b.length; i++) {
      const t = i / SR
      const env = Math.pow(Math.min(t / 0.5, 1), 2) * Math.exp(-Math.max(0, t - 1.1) * 2.2)
      ph += (TAU * f) / SR
      b[i] += (Math.sin(ph) + 0.3 * Math.sin(2 * ph)) * env * 0.1
    }
  }
  roll.forEach((f, i) => celesta(b, 0.9 + i * 0.07, f * 1.0, 0.4, rnd))
  writeWav('legend.wav', b, 0.8)
}

function genGameOver() {
  const b = buf(1.6)
  let ph = 0, ph2 = 0
  for (let i = 0; i < b.length; i++) {
    const t = i / SR
    const u = Math.min(t / 1.1, 1)
    const f = 392 * Math.pow(147 / 392, u)
    const vib = 1 + 0.025 * Math.sin(TAU * (4 + 6 * u) * t)
    ph += (TAU * f * vib) / SR
    ph2 += (TAU * f * 0.5 * vib) / SR
    const env = Math.min(t / 0.02, 1) * Math.exp(-t * 1.9)
    b[i] = (Math.sin(ph) * 0.8 + Math.sin(ph2) * 0.5) * env
  }
  writeWav('gameover.wav', b, 0.7)
}

function genTick() {
  const b = buf(0.04)
  const lp = svf(2400, 1.2)
  const rnd = mulberry32(5)
  for (let i = 0; i < b.length; i++) {
    const t = i / SR
    b[i] = lp((rnd() * 2 - 1) * Math.exp(-t * 220)) * 2
  }
  writeWav('tick.wav', b, 0.4)
}

function genThwip() {
  // drop release: band-passed noise snap + quick sine drop 900→400 Hz
  const b = buf(0.1)
  const bp = svf(1400, 1.8, 'bp')
  const rnd = mulberry32(41)
  let ph = 0
  for (let i = 0; i < b.length; i++) {
    const t = i / SR
    const f = 900 * Math.pow(400 / 900, Math.min(t / 0.06, 1))
    ph += (TAU * f) / SR
    const snap = bp((rnd() * 2 - 1)) * Math.exp(-t * 120) * 2.5
    b[i] = snap + Math.sin(ph) * Math.exp(-t * 45) * 0.8
  }
  writeWav('thwip.wav', b, 0.55)
}

function genTing() {
  // jar resonance for big merges: 2093 Hz + inharmonic glass partials
  const b = buf(1.0)
  const parts = [[1, 1, 3.2], [2.76, 0.35, 6], [5.4, 0.18, 11]]
  for (const [ratio, amp, decay] of parts) {
    let ph = 0
    for (let i = 0; i < b.length; i++) {
      const t = i / SR
      ph += (TAU * 2093 * ratio) / SR
      b[i] += Math.sin(ph) * amp * Math.min(t / 0.002, 1) * Math.exp(-t * decay)
    }
  }
  writeWav('ting.wav', b, 0.4)
}

function genStarSnack() {
  // pickup-coin arpeggio ending in an upward gulp bloop
  const b = buf(0.9)
  const rnd = mulberry32(55)
  const seq = [[0, 1318.5], [0.07, 1568], [0.14, 2093], [0.21, 2637]]
  for (const [t, f] of seq) celesta(b, t, f, 0.7, rnd)
  let ph = 0
  for (let i = Math.floor(0.3 * SR); i < b.length; i++) {
    const t = (i - 0.3 * SR) / SR
    const f = 300 * Math.pow(2.6, Math.min(t / 0.18, 1))
    ph += (TAU * f) / SR
    b[i] += Math.sin(ph) * Math.sin(Math.PI * Math.min(t / 0.25, 1)) * 0.5
  }
  writeWav('starsnack.wav', b, 0.7)
}

// ---------------------------------------------------------------- music loop (stereo, seamless)

function genMusic() {
  const LEN = 16.0
  const N = Math.floor(LEN * SR)
  const mono = new Float32Array(N)
  const rnd = mulberry32(20260611)

  // warm pad: C — Am — F — G, 4 s each, soft triangle-ish voices
  const chords = [
    [130.81, 196.0, 261.63, 329.63],  // C3 G3 C4 E4
    [110.0, 220.0, 261.63, 329.63],   // A2 A3 C4 E4
    [87.31, 174.61, 261.63, 349.23],  // F2 F3 C4 F4
    [98.0, 196.0, 246.94, 293.66],    // G2 G3 B3 D4
  ]
  for (let c = 0; c < 4; c++) {
    const t0 = c * 4
    for (const f of chords[c]) {
      let ph = rnd() * TAU
      for (let i = 0; i < 4 * SR; i++) {
        const t = i / SR
        // smooth 0.6 s crossfade in/out keeps chord changes (and the loop seam) soft
        const env = Math.min(t / 0.6, 1, (4 - t) / 0.6)
        ph += (TAU * f) / SR
        const idx = (Math.floor(t0 * SR) + i) % N
        mono[idx] += (Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph)) * env * 0.045
      }
    }
  }

  // music-box plinks: gentle random walk on C pentatonic, eighth-note grid
  const scale = [523.25, 587.33, 659.26, 784, 880, 1046.5, 1174.7, 1318.5, 1568, 1760]
  let pos = 4
  const grid = 0.4
  for (let s = 0; s < Math.floor(LEN / grid); s++) {
    if (rnd() < 0.42) continue
    pos = Math.max(0, Math.min(scale.length - 1, pos + Math.floor(rnd() * 5) - 2))
    const vel = 0.16 + rnd() * 0.2
    celesta(mono, s * grid + (rnd() - 0.5) * 0.02, scale[pos], vel, rnd, true)
    if (rnd() < 0.18) celesta(mono, s * grid, scale[Math.max(0, pos - 3)], vel * 0.6, rnd, true)
  }

  // stereo via wrapped ping-pong echoes (wrap keeps the loop seamless)
  const L = new Float32Array(N), R = new Float32Array(N)
  const dL = Math.floor(0.31 * SR), dR = Math.floor(0.47 * SR)
  for (let i = 0; i < N; i++) {
    const echoL = mono[(i - dL + N) % N] * 0.26
    const echoR = mono[(i - dR + N) % N] * 0.22
    L[i] = mono[i] * 0.95 + echoL + echoR * 0.4
    R[i] = mono[i] * 0.95 + echoR + echoL * 0.4
  }
  // music ships at 22.05 kHz — kalimba/pad content tops out well below 10 kHz,
  // and this halves the largest asset for web deploys
  writeWav('music.wav', [decimate2(L), decimate2(R)], 0.42, SR / 2)
}

console.log('Generating audio assets →', OUT)
genDrop()
genMerge('merge_small.wav', 1.25, 0.22, 31)
genMerge('merge_mid.wav', 1.0, 0.3, 32)
genMerge('merge_big.wav', 0.68, 0.42, 33)
genPopTiny()
genSparkle()
genFanfare()
genLegend()
genGameOver()
genTick()
genThwip()
genTing()
genStarSnack()
genMusic()
console.log('Done.')
