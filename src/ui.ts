// DOM HUD + overlays: score, next preview, Star Snack lamp, evolution strip,
// floating score popups, discovery banner, title & bedtime screens.
import { RULES, TIERS } from './config'

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id}`)
  return node as T
}

/** tiny inline-SVG portrait of a tier (next preview + evo strip) */
function blobSVG(tier: number, size: number): string {
  const t = TIERS[tier]
  const id = `g${tier}-${size}`
  const crown = t.extra === 'crown' || t.extra === 'aurora'
    ? `<text x="32" y="14" font-size="13" text-anchor="middle">${t.extra === 'crown' ? '👑' : '✨'}</text>`
    : ''
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-label="${t.name}">
    <defs><radialGradient id="${id}" cx="38%" cy="32%" r="75%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="35%" stop-color="${t.color}"/>
      <stop offset="100%" stop-color="${t.accent}"/>
    </radialGradient></defs>
    <circle cx="32" cy="36" r="25" fill="url(#${id})"/>
    <circle cx="24" cy="33" r="3.4" fill="#38203A"/>
    <circle cx="40" cy="33" r="3.4" fill="#38203A"/>
    <circle cx="25.3" cy="31.8" r="1.2" fill="#fff"/>
    <circle cx="41.3" cy="31.8" r="1.2" fill="#fff"/>
    <path d="M26 41 Q32 47 38 41" stroke="#38203A" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    ${crown}
  </svg>`
}

export class UI {
  onStart: (() => void) | null = null
  onRestart: (() => void) | null = null
  onToggleSound: (() => boolean) | null = null
  onToggleMusic: (() => boolean) | null = null
  onArmStar: (() => void) | null = null

  private scoreVal = el('score-val')
  private bestVal = el('best-val')
  private nextBubble = el('next-bubble')
  private starBtn = el<HTMLButtonElement>('star-btn')
  private starTicks = el('star-ticks')
  private evo = el('evo')
  private bannerEl = el('banner')
  private popups = el('popups')
  private title = el('title')
  private over = el('over')
  private bannerTimer = 0
  private chainPop: HTMLDivElement | null = null
  private chainTotal = 0

  constructor() {
    this.title.addEventListener('pointerdown', () => {
      this.onStart?.()
    })
    // keyboard players can start too
    window.addEventListener('keydown', (e) => {
      if (!this.title.classList.contains('hidden') && (e.code === 'Space' || e.code === 'Enter')) {
        this.onStart?.()
      }
    })
    // pretty character blobs on the title screen
    const demoBlobs = document.querySelector('.demo-blobs')
    if (demoBlobs) {
      demoBlobs.innerHTML = [0, 2, 5]
        .map((t, i) => `<span style="background:none;box-shadow:none;animation-delay:${i * 0.3}s">${blobSVG(t, 44 + i * 10)}</span>`)
        .join('')
    }
    el('btn-again').addEventListener('click', () => this.onRestart?.())
    el('btn-restart').addEventListener('click', () => this.onRestart?.())
    this.starBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.onArmStar?.()
    })
    el('btn-sound').addEventListener('click', () => {
      const on = this.onToggleSound?.() ?? true
      el('btn-sound').textContent = on ? '🔊' : '🔇'
    })
    el('btn-music').addEventListener('click', () => {
      const on = this.onToggleMusic?.() ?? true
      el('btn-music').textContent = on ? '🎵' : '🚫'
    })
  }

  setScore(n: number): void {
    this.scoreVal.textContent = String(n)
    this.scoreVal.classList.remove('bump')
    void this.scoreVal.offsetWidth // restart animation
    this.scoreVal.classList.add('bump')
  }

  setBest(n: number): void {
    this.bestVal.textContent = String(n)
  }

  setNext(tier: number): void {
    this.nextBubble.innerHTML = blobSVG(tier, 52)
  }

  setStar(charge: number, banked: boolean, armed: boolean): void {
    this.starBtn.classList.toggle('banked', banked)
    this.starBtn.classList.toggle('armed', armed)
    let html = ''
    for (let i = 0; i < RULES.starEvery; i++) {
      html += `<i class="${banked || i < charge ? 'on' : ''}"></i>`
    }
    this.starTicks.innerHTML = html
  }

  buildEvo(discovered: Set<number>): void {
    this.evo.innerHTML = TIERS.map((t, i) =>
      `<span class="evo-dot ${discovered.has(i) ? 'lit' : ''}" title="${t.name} — ${t.personality}">
        ${blobSVG(i, 26)}
      </span>`).join('')
  }

  discover(tier: number, discovered: Set<number>): void {
    this.buildEvo(discovered)
    this.banner(`✨ new dewling — ${TIERS[tier].name}! ✨`)
  }

  banner(text: string): void {
    this.bannerEl.textContent = text
    this.bannerEl.classList.add('show')
    clearTimeout(this.bannerTimer)
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('show'), 2400)
  }

  scorePop(x: number, y: number, text: string, combo: number, value = 0): void {
    // chains accumulate into ONE growing popup instead of stacking clutter
    if (combo >= 2 && this.chainPop?.isConnected) {
      this.chainTotal += value
      const div = this.chainPop
      div.textContent = `+${this.chainTotal} ×${combo} chain!`
      div.style.left = `${x}px`
      div.style.top = `${y}px`
      div.style.fontSize = `${Math.min(22 + combo * 4, 44)}px`
      div.style.animation = 'none'
      void div.offsetWidth
      div.style.animation = ''
      return
    }
    const div = document.createElement('div')
    div.className = 'pop' + (combo >= 2 ? ' chain' : '')
    div.textContent = combo >= 2 ? `${text} ×${combo} chain!` : text
    div.style.left = `${x + (combo >= 2 ? 0 : (Math.random() - 0.5) * 48)}px`
    div.style.top = `${y}px`
    div.style.fontSize = `${combo >= 2 ? 22 + combo * 4 : 19}px`
    this.popups.appendChild(div)
    div.addEventListener('animationend', () => {
      div.remove()
      if (div === this.chainPop) this.chainPop = null
    })
    if (combo >= 2) {
      this.chainPop = div
      this.chainTotal = value
    }
  }

  /** reflect persisted audio prefs at boot */
  setAudioGlyphs(sfxOn: boolean, musicOn: boolean): void {
    el('btn-sound').textContent = sfxOn ? '🔊' : '🔇'
    el('btn-music').textContent = musicOn ? '🎵' : '🚫'
  }

  private fadeOut(node: HTMLElement): void {
    node.classList.add('hidden')
    window.setTimeout(() => {
      if (node.classList.contains('hidden')) node.style.display = 'none'
    }, 500)
  }

  hideTitle(): void {
    this.fadeOut(this.title)
  }

  showOver(score: number, best: number, isNew: boolean): void {
    el('over-best').textContent = `best night: ${best}`
    el('new-best').classList.toggle('hidden', !isNew)
    this.over.style.display = 'flex'
    this.over.classList.remove('hidden')
    // gentle count-up tally (timer fallback guarantees the final value)
    const target = score
    const scoreEl = el('over-score')
    const t0 = performance.now()
    const dur = Math.min(1400, 400 + target * 2)
    const tick = (t: number) => {
      const u = Math.min(1, Math.max(0, (t - t0) / dur))
      scoreEl.textContent = String(Math.round(target * (1 - Math.pow(1 - u, 3))))
      if (u < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    window.setTimeout(() => { scoreEl.textContent = String(target) }, dur + 150)
  }

  hideOver(): void {
    this.fadeOut(this.over)
  }

  hideLoading(): void {
    this.fadeOut(el('loading'))
  }
}
