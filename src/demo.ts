// ?demo=1 — deterministic autoplay for headless screenshots + smoke checks.
import type { Game } from './game'
import type { Input } from './input'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

declare global {
  interface Window {
    __game?: { score: () => number; blobs: () => number; state: () => string }
    __renderReady?: boolean
  }
}

export function setupDemo(game: Game, input: Input): boolean {
  const params = new URLSearchParams(location.search)
  window.__game = {
    score: () => game.score,
    blobs: () => (game as unknown as { world: { bodies: unknown[] } })['world'].bodies.length,
    state: () => game.state,
  }
  if (!params.has('demo')) return false

  const rng = mulberry32(20260611)
  game.rng = mulberry32(424242)
  game.start()
  const stat = document.createElement('div')
  stat.id = 'demostat'
  stat.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.appendChild(stat)
  let ticks = 0
  window.setInterval(() => {
    ticks++
    input.simulate(game.demoTargetX(rng()))
    window.setTimeout(() => input.requestDrop(), 60)
    stat.textContent = `demo ticks=${ticks} score=${game.score} blobs=${window.__game?.blobs()} state=${game.state}`
  }, 750)
  return true
}
