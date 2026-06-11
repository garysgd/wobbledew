// WebAudio playback of the generated .wav assets. Lazy AudioContext (browser
// autoplay policy), pitch jitter, pentatonic combo steps, music ducking.
const FILES = [
  'drop', 'merge_small', 'merge_mid', 'merge_big', 'pop', 'sparkle',
  'fanfare', 'legend', 'gameover', 'tick', 'thwip', 'ting', 'starsnack', 'music',
] as const
export type SfxName = (typeof FILES)[number]

const PENTA = [0, 2, 4, 7, 9]

function pref(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? dflt : v === '1'
  } catch {
    return dflt
  }
}

export class AudioMan {
  private ctx: AudioContext | null = null
  private raw = new Map<string, ArrayBuffer>()
  private buffers = new Map<string, AudioBuffer>()
  private sfxGain: GainNode | null = null
  private musicGain: GainNode | null = null
  private musicSrc: AudioBufferSourceNode | null = null
  private lastPlay = new Map<string, number>()
  private active = 0
  sfxOn = pref('wd_sfx', true)
  musicOn = pref('wd_music', true)
  private unlocked = false
  private preloadP: Promise<void> | null = null

  /** fetch all wavs in the background (no AudioContext needed yet) */
  preload(): Promise<void> {
    const base = import.meta.env.BASE_URL
    this.preloadP = Promise.all(FILES.map(async (name) => {
      try {
        const res = await fetch(`${base}audio/${name}.wav`)
        this.raw.set(name, await res.arrayBuffer())
      } catch {
        // missing audio is non-fatal
      }
    })).then(() => undefined)
    return this.preloadP
  }

  /** Call from a user gesture. The AudioContext MUST be created + resumed
   *  synchronously inside the gesture (iOS Safari) — decoding happens after. */
  unlock(): void {
    if (this.unlocked) {
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume()
      return
    }
    this.unlocked = true
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctx()
    void this.ctx.resume()
    this.sfxGain = this.ctx.createGain()
    this.sfxGain.gain.value = 0.9
    this.sfxGain.connect(this.ctx.destination)
    this.musicGain = this.ctx.createGain()
    this.musicGain.gain.value = 0.55
    this.musicGain.connect(this.ctx.destination)
    void this.decodeAll()
  }

  private async decodeAll(): Promise<void> {
    await this.preloadP
    if (!this.ctx) return
    await Promise.all([...this.raw.entries()].map(async ([name, buf]) => {
      try {
        this.buffers.set(name, await this.ctx!.decodeAudioData(buf.slice(0)))
      } catch {
        // skip undecodable
      }
    }))
    if (this.musicOn) this.startMusic()
  }

  /** lock-screen / tab-switch handling */
  setSuspended(hidden: boolean): void {
    if (!this.ctx) return
    if (hidden) void this.ctx.suspend()
    else void this.ctx.resume()
  }

  /** gentle music fade (bedtime) */
  fadeMusic(target: number, secs: number): void {
    if (!this.ctx || !this.musicGain) return
    const g = this.musicGain.gain
    const now = this.ctx.currentTime
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(target, now + secs)
  }

  /** restore default music level (new game) */
  restoreMusic(): void {
    this.fadeMusic(0.55, 0.6)
  }

  play(name: SfxName, opts: { rate?: number; vol?: number; jitter?: number } = {}): void {
    if (!this.ctx || !this.sfxGain || !this.sfxOn) return
    const buf = this.buffers.get(name)
    if (!buf) return
    const now = this.ctx.currentTime
    const last = this.lastPlay.get(name) ?? -1
    if (now - last < 0.03) return // anti machine-gun
    if (this.active > 14) return
    this.lastPlay.set(name, now)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const jitter = opts.jitter ?? 0.03
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter)
    const g = this.ctx.createGain()
    g.gain.value = opts.vol ?? 1
    src.connect(g).connect(this.sfxGain)
    this.active++
    src.onended = () => { this.active-- }
    src.start()
  }

  /** landing plop, pitched lower for big tiers */
  plop(tier: number, strength: number): void {
    const rate = Math.pow(0.92, tier) * 1.25
    this.play('drop', { rate, vol: Math.min(0.2 + strength * 0.0008, 0.9) })
  }

  /** merge squelch: tier band sample + pentatonic combo pitch rise */
  merge(tier: number, combo: number): void {
    const name: SfxName = tier <= 3 ? 'merge_small' : tier <= 7 ? 'merge_mid' : 'merge_big'
    const step = Math.min(combo - 1, 9)
    const semis = PENTA[step % 5] + 12 * Math.floor(step / 5)
    this.play(name, { rate: Math.pow(2, semis / 12), vol: 0.95 })
    if (combo >= 3) this.play('sparkle', { vol: 0.5, rate: 1 + combo * 0.04 })
    if (tier >= 5) this.play('ting', { vol: 0.4, rate: 1 - tier * 0.03 })
    this.duck()
  }

  startMusic(): void {
    if (!this.ctx || !this.musicGain) return
    this.stopMusic()
    const buf = this.buffers.get('music')
    if (!buf) return
    this.musicSrc = this.ctx.createBufferSource()
    this.musicSrc.buffer = buf
    this.musicSrc.loop = true
    this.musicSrc.connect(this.musicGain)
    this.musicSrc.start()
  }

  stopMusic(): void {
    try {
      this.musicSrc?.stop()
    } catch { /* already stopped */ }
    this.musicSrc = null
  }

  private duck(): void {
    if (!this.ctx || !this.musicGain) return
    const g = this.musicGain.gain
    const now = this.ctx.currentTime
    g.cancelScheduledValues(now)
    g.setValueAtTime(Math.min(g.value, 0.38), now)
    g.linearRampToValueAtTime(0.55, now + 0.4)
  }

  setSfx(on: boolean): void {
    this.sfxOn = on
    try { localStorage.setItem('wd_sfx', on ? '1' : '0') } catch { /* private mode */ }
  }

  setMusic(on: boolean): void {
    this.musicOn = on
    try { localStorage.setItem('wd_music', on ? '1' : '0') } catch { /* private mode */ }
    if (on) this.startMusic()
    else this.stopMusic()
  }
}
