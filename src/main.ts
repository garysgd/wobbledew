// Boot: assets → scene → game → fixed-timestep loop.
import { SceneCtx } from './render/scene'
import { makeMatcap, makeEyeAtlas, makeBlush } from './render/textures'
import { loadArt } from './render/art'
import type { SharedArt } from './render/jelly'
import { Particles } from './fx/particles'
import { AudioMan } from './audio'
import { Input } from './input'
import { UI } from './ui'
import { Game } from './game'
import { setupDemo } from './demo'

function bootLog(msg: string): void {
  const log = document.getElementById('errlog')
  if (log) log.textContent += `boot:${msg};`
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement
  const scene = new SceneCtx(canvas)
  bootLog('scene')

  const audio = new AudioMan()
  void audio.preload() // background — boot must never block on audio bytes
  const art = await loadArt()
  bootLog('art')
  const shared: SharedArt = {
    matcap: makeMatcap(),
    eyeAtlas: makeEyeAtlas(),
    blush: makeBlush(),
    art,
  }
  const particles = new Particles(scene.scene, art)
  const ui = new UI()
  const input = new Input()
  input.attach(document.body, (x, y) => scene.unproject(x, y))

  const game = new Game({ scene, particles, audio, ui, input, shared })

  ui.onStart = () => {
    audio.unlock()
    game.start()
  }
  ui.onRestart = () => {
    audio.unlock()
    game.reset()
  }
  ui.onToggleSound = () => {
    audio.setSfx(!audio.sfxOn)
    return audio.sfxOn
  }
  ui.onToggleMusic = () => {
    audio.setMusic(!audio.musicOn)
    return audio.musicOn
  }
  ui.onArmStar = () => game.toggleStarArm()
  ui.setAudioGlyphs(audio.sfxOn, audio.musicOn)

  // every gesture unlocks/resumes audio (iOS interruptions, lock screen, calls)
  document.addEventListener('pointerdown', () => audio.unlock())
  document.addEventListener('touchend', () => audio.unlock())
  document.addEventListener('visibilitychange', () => audio.setSuspended(document.hidden))

  // WebGL context loss: surface it rather than freezing silently
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    ui.banner('graphics context lost — please reload 🙏')
  })

  ui.hideLoading()
  const demo = setupDemo(game, input)
  if (demo) ui.hideTitle()
  bootLog(`ready demo=${demo}`)

  // loop diagnostics, readable via --dump-dom in headless verification
  const stat = document.createElement('div')
  stat.id = 'loopstat'
  stat.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.appendChild(stat)
  let frames = 0
  let steps = 0

  const STEP = 1 / 60
  let last = performance.now()
  let acc = 0
  const advance = (now: number): number => {
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05))
    last = now
    acc += dt
    try {
      while (acc >= STEP) {
        game.update(STEP)
        acc -= STEP
        steps++
      }
    } catch (err) {
      stat.textContent = `LOOP ERR: ${err instanceof Error ? `${err.message} ${err.stack?.split('\n')[1] ?? ''}` : String(err)}`
      throw err
    }
    frames++
    if (demo && frames % 30 === 0 && !stat.textContent.startsWith('LOOP ERR')) {
      stat.textContent = `frames=${frames} steps=${steps} dt=${dt.toFixed(5)} acc=${acc.toFixed(5)}`
    }
    return dt
  }

  if (demo) {
    // Headless virtual time pumps timers, not rAF: step logic on a timer, but
    // present frames in rAF (canvas only composites during BeginFrame).
    let vnow = performance.now()
    window.setInterval(() => {
      vnow += 1000 / 60
      advance(vnow)
    }, 1000 / 60)
    const rloop = () => {
      requestAnimationFrame(rloop)
      scene.render(1 / 60, vnow / 1000)
      if (!window.__renderReady) window.__renderReady = true
    }
    requestAnimationFrame(rloop)
  } else {
    const loop = (now: number) => {
      requestAnimationFrame(loop)
      const dt = advance(now)
      scene.render(dt, now / 1000)
      if (!window.__renderReady) window.__renderReady = true
    }
    requestAnimationFrame(loop)
  }
}

boot().catch((err: unknown) => {
  const loader = document.querySelector('#loading .loader')
  if (loader) {
    loader.textContent = '😢 failed to load — please refresh'
    ;(loader as HTMLElement).style.fontSize = '1.1rem'
  }
  const log = document.getElementById('errlog')
  if (log) log.textContent += `BOOT FAIL: ${err instanceof Error ? err.message : String(err)}\n`
  throw err
})
