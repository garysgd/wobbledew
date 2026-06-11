// Deterministic 2D verlet circle solver. Drives the 3D jelly meshes.
// Positional relaxation gives soft, Suika-fair stacking; the bounce/wobble you
// SEE is done in the vertex shader from real contact data exported here.
// Feel targets (from design brief research): equal mass all tiers, restitution
// ~0.15, low tangential friction, 8 substeps, merge on FIRST contact.

export interface Contact {
  /** unit direction from body center toward the contact, design-space */
  nx: number
  ny: number
  /** overlap depth in px */
  depth: number
}

export interface JellyBody {
  id: number
  x: number
  y: number
  px: number
  py: number
  r: number
  tier: number
  /** seconds since spawn */
  age: number
  alive: boolean
  /** true once this body has contacted anything (lose-line + re-arm gate) */
  touched: boolean
  /** star-snack pellet flag — upgrades first blob it touches */
  isStar: boolean
  /** strongest contacts this frame (≤ MAX_CONTACTS), for shader + faces */
  contacts: Contact[]
  /** |Δv| this frame in px/s — impact strength for wobble/SFX */
  impact: number
  onFloor: boolean
  /** accumulated seconds of continuous lose-line overlap */
  dangerTime: number
  /** pending external accel (snuggle seek), reset each frame */
  ax: number
  ay: number
  /** id of current snuggle partner, 0 = none (faces lean toward partner) */
  snuggleWith: number
  vxLast: number
  vyLast: number
}

export interface StepEvents {
  merges: Array<[JellyBody, JellyBody]>
  impacts: Array<{ body: JellyBody; strength: number }>
  /** star pellet → blob it touched first */
  starHits: Array<{ star: JellyBody; target: JellyBody }>
}

export const MAX_CONTACTS = 4

export const SUBSTEPS = 8
const PASSES = 3
const DAMP = 0.9992
const PAIR_SLACK = 0.96 // resolve to 96% separation → visible squish overlap
const WALL_SLACK = 0.93
const FLOOR_SLACK = 0.93
const MERGE_DIST = 0.99
const MERGE_MIN_AGE = 0.02 // one frame — avoids same-frame spawn collisions only
const RESTITUTION = 0.15
const FLOOR_FRICTION = 0.012
const MAX_SUBSTEP_SPEED = 15 // px per substep, anti-tunneling
const IMPACT_MIN = 260 // px/s Δv below which we ignore impacts

let nextId = 1

export function createBody(x: number, y: number, r: number, tier: number, isStar = false): JellyBody {
  return {
    id: nextId++,
    x, y, px: x, py: y, r, tier,
    age: 0, alive: true, touched: false, isStar,
    contacts: [], impact: 0, onFloor: false, dangerTime: 0,
    ax: 0, ay: 0, snuggleWith: 0,
    vxLast: 0, vyLast: 0,
  }
}

export interface WorldOptions {
  snuggleGap: number
  snuggleAccel: number
}

export class World {
  bodies: JellyBody[] = []

  /** y-up world: floor is the lowest y, gravity is negative */
  constructor(
    public left: number,
    public right: number,
    public floor: number,
    public gravity = -2600,
    public opts: WorldOptions = { snuggleGap: 0.5, snuggleAccel: 340 },
  ) {}

  add(body: JellyBody): void {
    this.bodies.push(body)
  }

  remove(body: JellyBody): void {
    body.alive = false
    const i = this.bodies.indexOf(body)
    if (i >= 0) this.bodies.splice(i, 1)
  }

  clear(): void {
    this.bodies.length = 0
  }

  /** Nudge a body's implied velocity (used for merge "pop" relief). */
  impulse(body: JellyBody, ix: number, iy: number): void {
    body.px -= ix
    body.py -= iy
  }

  step(dt: number): StepEvents {
    const events: StepEvents = { merges: [], impacts: [], starHits: [] }
    const bodies = this.bodies
    const h = dt / SUBSTEPS

    for (const b of bodies) {
      b.age += dt
      b.onFloor = false
      b.ax = 0
      b.ay = 0
      b.snuggleWith = 0
    }

    this.applySnuggleSeek()

    for (let s = 0; s < SUBSTEPS; s++) {
      // integrate
      for (const b of bodies) {
        let vx = (b.x - b.px) * DAMP
        let vy = (b.y - b.py) * DAMP
        const sp = Math.hypot(vx, vy)
        if (sp > MAX_SUBSTEP_SPEED) {
          vx *= MAX_SUBSTEP_SPEED / sp
          vy *= MAX_SUBSTEP_SPEED / sp
        }
        b.px = b.x
        b.py = b.y
        b.x += vx + b.ax * h * h
        b.y += vy + (this.gravity + b.ay) * h * h
      }

      // relax constraints — equal mass for the liquid-pile Suika feel
      for (let pass = 0; pass < PASSES; pass++) {
        for (let i = 0; i < bodies.length; i++) {
          const a = bodies[i]
          for (let j = i + 1; j < bodies.length; j++) {
            const b = bodies[j]
            const minD = (a.r + b.r) * PAIR_SLACK
            let dx = b.x - a.x
            let dy = b.y - a.y
            const d2 = dx * dx + dy * dy
            if (d2 >= minD * minD) continue
            let d = Math.sqrt(d2)
            if (d < 1e-6) {
              // perfectly stacked — deterministic separation by id
              dx = a.id < b.id ? 0.01 : -0.01
              dy = 0.01
              d = Math.hypot(dx, dy)
            }
            const overlap = (minD - d) * 0.5
            const ux = dx / d
            const uy = dy / d
            a.x -= ux * overlap
            a.y -= uy * overlap
            b.x += ux * overlap
            b.y += uy * overlap
          }
        }
        // bounds with restitution
        for (const b of bodies) {
          const rw = b.r * WALL_SLACK
          const rf = b.r * FLOOR_SLACK
          if (b.x < this.left + rw) {
            const vx = b.x - b.px
            b.x = this.left + rw
            b.px = b.x + vx * RESTITUTION
          } else if (b.x > this.right - rw) {
            const vx = b.x - b.px
            b.x = this.right - rw
            b.px = b.x + vx * RESTITUTION
          }
          if (b.y < this.floor + rf) {
            const vy = b.y - b.py
            b.y = this.floor + rf
            b.py = b.y + vy * RESTITUTION
            b.onFloor = true
            // tangential friction: bleed horizontal velocity so stacks settle
            b.px += (b.x - b.px) * FLOOR_FRICTION
          }
        }
      }
    }

    this.collectContacts()
    this.detectImpacts(dt, events)
    this.detectMerges(events)
    return events
  }

  /** Twist 1 — Snuggle Seek: nearest same-tier pair within range feels a weak
   *  mutual pull. Nearest-pair-only per tier; disabled while free-falling. */
  private applySnuggleSeek(): void {
    const { snuggleGap, snuggleAccel } = this.opts
    const best = new Map<number, [number, JellyBody, JellyBody]>()
    const bodies = this.bodies
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]
      if (!a.touched || a.isStar) continue
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]
        if (b.tier !== a.tier || !b.touched || b.isStar) continue
        const d = Math.hypot(b.x - a.x, b.y - a.y)
        const gap = d - (a.r + b.r)
        if (gap > snuggleGap * Math.min(a.r, b.r)) continue
        const cur = best.get(a.tier)
        if (!cur || gap < cur[0]) best.set(a.tier, [gap, a, b])
      }
    }
    for (const [, a, b] of best.values()) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 1
      a.ax += (dx / d) * snuggleAccel
      a.ay += (dy / d) * snuggleAccel
      b.ax -= (dx / d) * snuggleAccel
      b.ay -= (dy / d) * snuggleAccel
      a.snuggleWith = b.id
      b.snuggleWith = a.id
    }
  }

  private collectContacts(): void {
    const bodies = this.bodies
    for (const b of bodies) b.contacts.length = 0

    const push = (b: JellyBody, nx: number, ny: number, depth: number) => {
      if (depth <= 0) return
      if (b.contacts.length < MAX_CONTACTS) {
        b.contacts.push({ nx, ny, depth })
      } else {
        let weakest = 0
        for (let k = 1; k < b.contacts.length; k++)
          if (b.contacts[k].depth < b.contacts[weakest].depth) weakest = k
        if (b.contacts[weakest].depth < depth) b.contacts[weakest] = { nx, ny, depth }
      }
    }

    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]
        const touch = (a.r + b.r) * 1.02
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        if (d >= touch || d < 1e-6) continue
        const depth = touch - d
        push(a, dx / d, dy / d, depth)
        push(b, -dx / d, -dy / d, depth)
      }
      const wallTouch = a.r * 1.02
      const dl = a.x - this.left
      if (dl < wallTouch) push(a, -1, 0, wallTouch - dl)
      const dr = this.right - a.x
      if (dr < wallTouch) push(a, 1, 0, wallTouch - dr)
      const df = a.y - this.floor
      if (df < wallTouch) push(a, 0, -1, wallTouch - df)
    }

    for (const b of bodies) if (b.contacts.length > 0) b.touched = true
  }

  private detectImpacts(dt: number, events: StepEvents): void {
    for (const b of this.bodies) {
      const vx = (b.x - b.px) * (SUBSTEPS / dt)
      const vy = (b.y - b.py) * (SUBSTEPS / dt)
      const dvx = vx - b.vxLast
      const dvy = vy - b.vyLast
      const dv = Math.hypot(dvx, dvy)
      b.impact = dv
      if (dv > IMPACT_MIN && b.age > 0.1 && b.contacts.length > 0) {
        events.impacts.push({ body: b, strength: dv })
      }
      b.vxLast = vx
      b.vyLast = vy
    }
  }

  private detectMerges(events: StepEvents): void {
    const used = new Set<number>()
    const bodies = this.bodies
    const candidates: Array<[number, JellyBody, JellyBody]> = []
    const starCandidates: Array<[number, JellyBody, JellyBody]> = []
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]
      if (a.age < MERGE_MIN_AGE) continue
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]
        if (b.age < MERGE_MIN_AGE) continue
        const d = Math.hypot(b.x - a.x, b.y - a.y)

        // star pellet hit? collect all, resolve nearest-first below
        if (a.isStar !== b.isStar) {
          const star = a.isStar ? a : b
          const target = a.isStar ? b : a
          if (d < (a.r + b.r) * 1.0) starCandidates.push([d / (a.r + b.r), star, target])
          continue
        }
        if (a.isStar) continue

        if (b.tier !== a.tier) continue
        if (d < (a.r + b.r) * MERGE_DIST) {
          // upward precedence baked into sort: closer first, higher pair wins ties
          candidates.push([d / (a.r + b.r) - (a.y + b.y) * 1e-6, a, b])
        }
      }
    }
    starCandidates.sort((p, q) => p[0] - q[0])
    for (const [, star, target] of starCandidates) {
      if (used.has(star.id) || used.has(target.id)) continue
      used.add(star.id)
      used.add(target.id)
      events.starHits.push({ star, target })
    }
    candidates.sort((p, q) => p[0] - q[0])
    for (const [, a, b] of candidates) {
      if (used.has(a.id) || used.has(b.id)) continue
      used.add(a.id)
      used.add(b.id)
      events.merges.push([a, b])
    }
  }
}
