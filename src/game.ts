// Game orchestration: state machine, drops, merges, twists, lose-line bedtime.
import { DESIGN, RULES, TIERS, TIER_SCORE } from './config'
import { World, createBody, SUBSTEPS, type JellyBody } from './physics'
import { BlobView, StarView, type SharedArt } from './render/jelly'
import type { SceneCtx } from './render/scene'
import type { Particles } from './fx/particles'
import type { AudioMan } from './audio'
import type { UI } from './ui'
import type { Input } from './input'

const reducedMotion =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export interface GameDeps {
  scene: SceneCtx
  particles: Particles
  audio: AudioMan
  ui: UI
  input: Input
  shared: SharedArt
}

export type GameState = 'title' | 'playing' | 'bedtime'

const HW = DESIGN.jarHalfWidth
const STAR_R = 20

export class Game {
  state: GameState = 'title'
  score = 0
  best = 0
  rng: () => number = Math.random

  private world = new World(-HW, HW, DESIGN.floorY, RULES.gravity, {
    snuggleGap: RULES.snuggleGap,
    snuggleAccel: RULES.snuggleAccel,
  })
  private views = new Map<number, BlobView>()
  private starViews = new Map<number, StarView>()

  private held: BlobView | null = null
  private heldTier = 0
  private heldX = 0
  private heldY = DESIGN.dropY
  private nextTier = 0
  private waitingBody: JellyBody | null = null
  private armFallback = 0

  private mergeCount = 0
  private starBanked = false
  private starArmed = false
  private combo = 0
  private comboT = 0
  private hitStop = 0
  private time = 0
  private bedtimeT = 0
  private overShown = false
  private wasNewBest = false
  private heartbeatT = 0
  private discovered = new Set<number>([0, 1, 2, 3, 4])
  private lastImpactSfx = new Map<number, number>()

  constructor(private deps: GameDeps) {
    try {
      this.best = Number(localStorage.getItem('wd_best') ?? 0) || 0
    } catch { /* private mode */ }
    deps.ui.setBest(this.best)
    deps.ui.buildEvo(this.discovered)
  }

  start(): void {
    if (this.state === 'playing') return
    this.state = 'playing'
    this.deps.input.clearDrop()
    this.nextTier = Math.floor(this.rng() * RULES.droppableTiers)
    if (!this.held) this.spawnHeld()
    this.deps.ui.hideTitle()
  }

  reset(): void {
    for (const v of this.views.values()) v.dispose()
    this.views.clear()
    for (const v of this.starViews.values()) v.dispose()
    this.starViews.clear()
    this.world.clear()
    this.held?.dispose()
    this.held = null
    this.waitingBody = null
    this.score = 0
    this.combo = 0
    this.comboT = 0
    this.mergeCount = 0
    this.starBanked = false
    this.starArmed = false
    this.hitStop = 0
    this.bedtimeT = 0
    this.overShown = false
    this.lastImpactSfx.clear()
    this.discovered = new Set([0, 1, 2, 3, 4])
    this.deps.ui.setScore(0)
    this.deps.ui.setStar(0, false, false)
    this.deps.ui.buildEvo(this.discovered)
    this.deps.ui.hideOver()
    this.deps.scene.setLampDim(false)
    this.deps.input.clearDrop()
    this.deps.audio.restoreMusic()
    this.state = 'playing'
    this.nextTier = Math.floor(this.rng() * RULES.droppableTiers)
    this.spawnHeld()
  }

  /** demo autoplay helper: aim at a LOW same-tier twin, else emptiest column */
  demoTargetX(rand: number): number {
    let twin: JellyBody | null = null
    for (const b of this.world.bodies) {
      if (!b.isStar && b.tier === this.heldTier && (!twin || b.y < twin.y)) twin = b
    }
    if (twin && twin.y < 380) return twin.x
    let bestX = 0
    let bestTop = Infinity
    for (let i = 0; i < 5; i++) {
      const x = -HW + 120 + ((HW - 120) * 2 * i) / 4
      let top = 0
      for (const b of this.world.bodies) {
        if (Math.abs(b.x - x) < b.r + 60) top = Math.max(top, b.y + b.r)
      }
      if (top < bestTop) {
        bestTop = top
        bestX = x
      }
    }
    return bestX + (rand - 0.5) * 80
  }

  toggleStarArm(): void {
    if (!this.starBanked) return
    this.starArmed = !this.starArmed
    this.deps.ui.setStar(this.mergeCount % RULES.starEvery, this.starBanked, this.starArmed)
    this.deps.audio.play('tick')
  }

  update(dt: number): void {
    this.time += dt
    const { scene, particles, audio, ui, input } = this.deps
    input.update(dt)
    particles.update(dt)

    if (this.state === 'bedtime') {
      // tuck-in: slow-motion settle so nothing freezes mid-air, line fades
      if (this.bedtimeT < 1.4) this.world.step(dt * 0.35)
      scene.setLoseLineDanger(false, 0, this.time)
      for (const b of this.world.bodies) {
        if (b.isStar) this.starViews.get(b.id)?.update(this.time, b)
        else this.views.get(b.id)?.update(dt, this.time, b, null)
      }
      this.bedtimeT += dt
      if (this.bedtimeT > 1.7 && !this.overShown) {
        this.overShown = true
        ui.showOver(this.score, this.best, this.wasNewBest)
      }
      return
    }
    if (this.state !== 'playing') return

    // ---------------- held blob aiming + dropping
    if (this.held) {
      const r = TIERS[this.heldTier].r
      // clamp outside the wall-contact band (r*1.02) so edge drops still
      // free-fall and the contact-gated re-arm stays meaningful
      const tx = Math.max(-HW + r * 1.05, Math.min(HW - r * 1.05, input.worldX))
      this.heldX += (tx - this.heldX) * Math.min(1, dt * 14)
      this.heldY = DESIGN.dropY + Math.sin(this.time * 2.1) * 7
      this.held.update(dt, this.time, null, { x: this.heldX, y: 0 }, { x: this.heldX, y: this.heldY })
      if (input.consumeDrop()) this.drop()
    } else {
      this.armFallback -= dt
      const w = this.waitingBody
      if ((w && (w.touched || !w.alive)) || this.armFallback <= 0) this.spawnHeld()
    }

    // ---------------- physics (with hit-stop)
    const stepped = this.hitStop <= 0
    if (!stepped) {
      this.hitStop -= dt
    } else {
      const ev = this.world.step(dt)

      for (const { body, strength } of ev.impacts) {
        if (body.isStar) continue
        const view = this.views.get(body.id)
        const c = body.contacts[0]
        view?.onImpact(c?.nx ?? 0, c?.ny ?? -1, strength)
        const last = this.lastImpactSfx.get(body.id) ?? -9
        if (strength > 420 && this.time - last > 0.18) {
          this.lastImpactSfx.set(body.id, this.time)
          audio.plop(body.tier, strength)
          particles.landPoof(body.x, body.y - body.r * 0.8, TIERS[body.tier].color, strength)
        }
      }

      for (const hit of ev.starHits) this.processStar(hit.star, hit.target)
      for (const [a, b] of ev.merges) this.processMerge(a, b)
    }

    // chain window + lose grace pause while the world is frozen (hit-stop)
    if (stepped && this.comboT > 0) {
      this.comboT -= dt
      if (this.comboT <= 0) this.combo = 0
    }

    // ---------------- lose-line check (after merges resolve — canon)
    let maxDanger = 0
    let maxTop = -Infinity
    for (const b of this.world.bodies) {
      const top = b.y + b.r
      if (top > maxTop) maxTop = top
      // free-falling/launched blobs are exempt: must be in contact right now
      const over = top > DESIGN.loseLineY && b.contacts.length > 0 && !b.isStar
      if (stepped) b.dangerTime = over ? b.dangerTime + dt : 0
      if (b.dangerTime > maxDanger) maxDanger = b.dangerTime
    }
    const danger = Math.min(1, maxDanger / RULES.loseGrace)
    const approaching = maxTop > DESIGN.loseLineY * 0.85
    for (const b of this.world.bodies) {
      const view = this.views.get(b.id)
      if (view) view.worried = b.touched && (maxDanger > 0 ? approaching : b.y + b.r > DESIGN.loseLineY - 70)
    }
    scene.setLoseLineDanger(maxTop > DESIGN.loseLineY * 0.72, danger, this.time)
    if (maxDanger > 0) {
      // heartbeat escalation during the grace window
      this.heartbeatT -= dt
      if (this.heartbeatT <= 0) {
        this.heartbeatT = Math.max(0.18, 0.4 - danger * 0.2)
        audio.play('tick', { rate: 0.55, vol: 0.35 + danger * 0.5 })
        if (danger > 0.5) scene.addShake(0.05)
      }
    } else {
      this.heartbeatT = 0
    }
    if (maxDanger >= RULES.loseGrace) {
      this.bedtime()
      return
    }

    // ---------------- view updates + twist FX
    for (const b of this.world.bodies) {
      if (b.isStar) {
        this.starViews.get(b.id)?.update(this.time, b)
        particles.starTrail(b.x, b.y + b.r)
        continue
      }
      let look: { x: number; y: number } | null = { x: this.heldX, y: this.heldY }
      let snuggleDir: { x: number; y: number } | null = null
      if (b.snuggleWith !== 0) {
        const partner = this.world.bodies.find((o) => o.id === b.snuggleWith)
        if (partner) {
          look = { x: partner.x, y: partner.y }
          const dx = partner.x - b.x
          const dy = partner.y - b.y
          const dd = Math.hypot(dx, dy) || 1
          snuggleDir = { x: dx / dd, y: dy / dd }
          particles.snuggleSparkle((b.x + partner.x) / 2, (b.y + partner.y) / 2)
        }
      }
      this.views.get(b.id)?.update(dt, this.time, b, look, undefined, snuggleDir)
    }

    // dropper visuals: aim line down to the stack below the held blob
    if (this.held) {
      const r = TIERS[this.heldTier].r
      let stackTop = DESIGN.floorY
      for (const b of this.world.bodies) {
        if (Math.abs(b.x - this.heldX) < b.r + r * 0.4) stackTop = Math.max(stackTop, b.y + b.r)
      }
      scene.updateDropper(this.heldX, this.heldY, r, stackTop, this.starArmed && this.starBanked)
    } else {
      scene.updateDropper(null, this.heldY, 0, 0)
    }
  }

  private spawnHeld(): void {
    if (this.held) return
    this.heldTier = this.nextTier
    this.nextTier = Math.floor(this.rng() * RULES.droppableTiers)
    this.held = new BlobView(this.heldTier, this.deps.shared)
    this.held.pop()
    this.deps.scene.scene.add(this.held.group)
    this.deps.ui.setNext(this.nextTier)
    this.waitingBody = null
  }

  private drop(): void {
    const { audio, scene } = this.deps
    if (this.starArmed && this.starBanked) {
      // Twist 2: release the banked Star Snack instead (held blob stays)
      const body = createBody(this.heldX, this.heldY - 20, STAR_R, -1, true)
      this.world.add(body)
      const view = new StarView(this.deps.shared)
      scene.scene.add(view.group)
      this.starViews.set(body.id, view)
      this.starArmed = false
      this.starBanked = false
      this.deps.ui.setStar(this.mergeCount % RULES.starEvery, false, false)
      audio.play('thwip', { rate: 1.3 })
      return
    }
    if (!this.held) return
    const def = TIERS[this.heldTier]
    const body = createBody(this.heldX, this.heldY, def.r, this.heldTier)
    this.world.add(body)
    // release recoil: blob wobbles free, lamp bobs up
    this.held.excite(0.1, 0.06)
    scene.lampKick()
    this.views.set(body.id, this.held)
    this.held = null
    this.waitingBody = body
    this.armFallback = RULES.dropCooldown
    audio.play('thwip')
    if (navigator.vibrate && !reducedMotion) navigator.vibrate(10)
  }

  private removeBlob(b: JellyBody): void {
    this.world.remove(b)
    this.views.get(b.id)?.dispose()
    this.views.delete(b.id)
    this.lastImpactSfx.delete(b.id)
  }

  private velocityInto(body: JellyBody, vx: number, vy: number): void {
    // verlet: velocity is encoded as x - px per substep
    const h = 1 / 60 / SUBSTEPS
    body.px = body.x - vx * h
    body.py = body.y - vy * h
  }

  private processMerge(a: JellyBody, b: JellyBody): void {
    const { scene, particles, audio, ui } = this.deps
    if (!a.alive || !b.alive) return
    const t = a.tier
    this.score += TIER_SCORE[t]
    ui.setScore(this.score)
    this.combo = this.comboT > 0 ? this.combo + 1 : 1
    this.comboT = RULES.comboWindow

    const sum = a.r + b.r
    const mx = a.x + (b.x - a.x) * (a.r / sum)
    const my = a.y + (b.y - a.y) * (a.r / sum)
    const vx = (a.vxLast + b.vxLast) / 2
    const vy = (a.vyLast + b.vyLast) / 2
    this.removeBlob(a)
    this.removeBlob(b)

    const p = scene.project(mx, my)
    ui.scorePop(p.x, p.y, `+${TIER_SCORE[t]}`, this.combo, TIER_SCORE[t])

    if (t === TIERS.length - 1) {
      // two Borealis: wishes released back into the sky
      particles.celebration(mx, my)
      audio.play('legend')
      scene.addShake(0.4)
      ui.banner('🌌 wishes released into the sky! 🌌')
      if (navigator.vibrate && !reducedMotion) navigator.vibrate([60, 80, 60])
      this.afterMergeBookkeeping()
      return
    }

    const nt = t + 1
    const body = createBody(mx, my, TIERS[nt].r, nt)
    body.touched = true
    this.velocityInto(body, vx, vy * 0.6)
    this.world.add(body)
    const view = new BlobView(nt, this.deps.shared)
    view.pop()
    view.setMood('joy', 0.9)
    scene.scene.add(view.group)
    this.views.set(body.id, view)

    // tier-scaled pop impulse on neighbors — risk & reward.
    // impulse() shifts position-history: 1 unit ≈ 480 px/s, so keep k small.
    const range = TIERS[nt].r * 2.4
    for (const o of this.world.bodies) {
      if (o.id === body.id) continue
      const dx = o.x - mx
      const dy = o.y - my
      const dd = Math.hypot(dx, dy)
      if (dd < range && dd > 1) {
        const k = (1 - dd / range) * (0.22 + nt * 0.09)
        this.world.impulse(o, (dx / dd) * k, (dy / dd) * k + k * 0.3)
      }
    }

    particles.mergeBurst(mx, my, TIERS[nt].r, nt, TIERS[nt].color, this.combo)
    audio.merge(nt, this.combo)
    scene.addShake(RULES.shakeTrauma(nt))
    if (nt >= 5) scene.jarRipple(my)
    if (!reducedMotion) {
      // multi-merge same frame keeps the BIGGEST stop; chains add a little
      const stop = RULES.hitStop(nt) + 0.01 * Math.min(this.combo, 4)
      this.hitStop = Math.max(this.hitStop, stop)
    }
    if (navigator.vibrate && !reducedMotion) {
      navigator.vibrate(this.combo >= 3 ? [20, 30, 40] : Math.min(60, 15 + 5 * nt))
    }

    if (!this.discovered.has(nt)) {
      this.discovered.add(nt)
      ui.discover(nt, this.discovered)
      if (nt === TIERS.length - 1) {
        particles.celebration(mx, my)
        audio.play('legend')
        ui.banner('🐋 BOREALIS AWAKENS 🐋')
      } else if (nt >= 5) {
        audio.play('fanfare', { vol: 0.7 })
      } else {
        audio.play('sparkle', { vol: 0.6 })
      }
    }

    this.afterMergeBookkeeping()
  }

  private afterMergeBookkeeping(): void {
    this.mergeCount++
    if (this.mergeCount % RULES.starEvery === 0 && !this.starBanked) {
      this.starBanked = true
      this.deps.audio.play('starsnack', { vol: 0.55 })
      this.deps.ui.banner('⭐ star snack ready!')
    }
    this.deps.ui.setStar(this.mergeCount % RULES.starEvery, this.starBanked, this.starArmed)
  }

  private processStar(star: JellyBody, target: JellyBody): void {
    const { particles, audio, ui, scene } = this.deps
    this.world.remove(star)
    this.starViews.get(star.id)?.dispose()
    this.starViews.delete(star.id)
    if (!target.alive || target.tier >= TIERS.length - 1) {
      particles.mergeBurst(star.x, star.y, 40, 4, '#FFE8B8')
      audio.play('sparkle')
      return
    }
    const nt = target.tier + 1
    const pos = { x: target.x, y: target.y }
    const vx = target.vxLast
    const vy = target.vyLast
    this.removeBlob(target)
    const body = createBody(pos.x, pos.y, TIERS[nt].r, nt)
    body.touched = true
    this.velocityInto(body, vx, vy)
    this.world.add(body)
    const view = new BlobView(nt, this.deps.shared)
    view.pop()
    view.setMood('love', 1.2)
    scene.scene.add(view.group)
    this.views.set(body.id, view)
    // spend ceremony: the twist's payoff should outshine an ordinary merge
    particles.mergeBurst(pos.x, pos.y, TIERS[nt].r, nt, '#FFE8B8', 3)
    audio.play('starsnack')
    scene.jarRipple(pos.y)
    scene.addShake(0.12)
    const p = scene.project(pos.x, pos.y)
    ui.scorePop(p.x, p.y, '★ grew!', 1)
    if (!this.discovered.has(nt)) {
      this.discovered.add(nt)
      ui.discover(nt, this.discovered)
    }
  }

  private bedtime(): void {
    this.state = 'bedtime'
    this.bedtimeT = 0
    const { audio, scene, ui } = this.deps
    audio.play('gameover')
    audio.fadeMusic(0.12, 1.6)
    scene.setLampDim(true)
    scene.updateDropper(null, 0, 0, 0)
    this.held?.dispose()
    this.held = null
    for (const v of this.views.values()) v.setMood('sleep', 9999)
    this.wasNewBest = this.score > this.best
    if (this.wasNewBest) {
      this.best = this.score
      try { localStorage.setItem('wd_best', String(this.best)) } catch { /* private mode */ }
    }
    ui.setBest(this.best)
  }
}
