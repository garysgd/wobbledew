// BlobView: one Dewling — deformed jelly body + uniform-driven living face.
// Face parts are atlas quads sharing the body's deformation uniforms, so the
// face hugs the jelly perfectly (brief: "faces are physics readouts").
import * as THREE from 'three'
import vertSrc from '../shaders/jelly.vert.glsl?raw'
import fragSrc from '../shaders/jelly.frag.glsl?raw'
import partVertSrc from '../shaders/part.vert.glsl?raw'
import partFragSrc from '../shaders/part.frag.glsl?raw'
import { TIERS, type TierDef } from '../config'
import type { JellyBody } from '../physics'
import type { ArtAssets } from './art'

export interface SharedArt {
  matcap: THREE.Texture
  eyeAtlas: THREE.Texture
  blush: THREE.Texture
  art: ArtAssets
}

let sphereGeo: THREE.SphereGeometry | null = null
let quadGeo: THREE.PlaneGeometry | null = null

function getSphere(): THREE.SphereGeometry {
  if (!sphereGeo) sphereGeo = new THREE.SphereGeometry(1, 36, 26)
  return sphereGeo
}
function getQuad(): THREE.PlaneGeometry {
  if (!quadGeo) quadGeo = new THREE.PlaneGeometry(1, 1)
  return quadGeo
}

export type Mood = 'idle' | 'joy' | 'squish' | 'love' | 'worried' | 'sleep'

const MOOD_FACE: Record<Exclude<Mood, 'idle'>, { eyeL: number; eyeR: number; mouth: number }> = {
  joy: { eyeL: 2, eyeR: 2, mouth: 1 },
  squish: { eyeL: 3, eyeR: 3, mouth: 3 },
  love: { eyeL: 5, eyeR: 5, mouth: 0 },
  worried: { eyeL: 0, eyeR: 0, mouth: 4 },
  sleep: { eyeL: 4, eyeR: 4, mouth: 7 },
}

function surfZ(x: number, y: number): number {
  return Math.sqrt(Math.max(0.05, 1 - x * x - y * y))
}

interface Part {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  base: THREE.Vector3
  scale: THREE.Vector2
}

export class BlobView {
  group = new THREE.Group()
  def: TierDef
  tier: number

  // shared uniform value objects (same refs across body + part materials)
  private uTime = { value: 0 }
  private uSquash = { value: new THREE.Vector3(0, 1, 0) }
  private uContacts = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }
  private uWobble = { value: new THREE.Vector4(0, 0, 0, 0) }
  private uFlash = { value: 0 }
  private seed = Math.random() * 100

  private bodyMat: THREE.ShaderMaterial
  private eyeL: Part
  private eyeR: Part
  private mouth: Part
  private blushL?: Part
  private blushR?: Part
  private extras: Part[] = []
  private allMats: THREE.ShaderMaterial[] = []

  // animation state
  private scaleX = 1
  private scaleV = 0
  private wAmp2 = 0
  private wPh2 = 0
  private wAmp3 = 0
  private wPh3 = 0
  private blinkTimer = 1 + Math.random() * 3
  private blinkPhase = 0
  private pulseT = 0
  private pulseDur = 0.18
  private pulseAmt = 0
  private pulseDir = new THREE.Vector2(0, 1)
  private mood: Mood = 'idle'
  private moodT = 0
  worried = false
  private lastX = 0
  private lastY = 0
  private hasLast = false

  constructor(tier: number, shared: SharedArt) {
    this.tier = tier
    this.def = TIERS[tier]
    // saturated body: deep shadow keeps hue, light stays candy-colored
    const c = new THREE.Color(this.def.color)
    const deep = c.clone().lerp(new THREE.Color('#241038'), 0.4)
    const light = c.clone().lerp(new THREE.Color('#ffffff'), 0.26)
    const rim = new THREE.Color(this.def.accent).lerp(new THREE.Color('#ffffff'), 0.35)

    this.bodyMat = new THREE.ShaderMaterial({
      vertexShader: vertSrc,
      fragmentShader: fragSrc,
      uniforms: {
        uTime: this.uTime,
        uSeed: { value: this.seed },
        uSquash: this.uSquash,
        uContacts: this.uContacts,
        uWobble: this.uWobble,
        uFlash: this.uFlash,
        uMatcap: { value: shared.matcap },
        uColorDeep: { value: deep },
        uColorLight: { value: light },
        uRimColor: { value: rim },
        uAurora: { value: this.def.extra === 'aurora' ? 1 : 0 },
      },
    })
    this.allMats.push(this.bodyMat)
    const body = new THREE.Mesh(getSphere(), this.bodyMat)
    body.frustumCulled = false
    this.group.add(body)

    const es = this.def.eyeScale
    const ex = 0.34
    const ey = 0.14
    this.eyeL = this.makePart(shared.eyeAtlas, this.def.eyeL, 8, new THREE.Vector3(-ex, ey, surfZ(ex, ey) + 0.06), new THREE.Vector2(es, es))
    this.eyeR = this.makePart(shared.eyeAtlas, this.def.eyeR, 8, new THREE.Vector3(ex, ey, surfZ(ex, ey) + 0.06), new THREE.Vector2(-es, es))
    this.mouth = this.makePart(shared.art.mouths, this.def.mouth, 8, new THREE.Vector3(0, -0.16, surfZ(0, 0.16) + 0.06), new THREE.Vector2(0.46, 0.46))
    if (this.def.blush > 0.05) {
      const bs = 0.105 + es * 0.32
      this.blushL = this.makePart(shared.blush, 0, 1, new THREE.Vector3(-0.5, -0.1, surfZ(0.5, 0.1) + 0.05), new THREE.Vector2(bs * 1.45, bs), this.def.blush * 0.85)
      this.blushR = this.makePart(shared.blush, 0, 1, new THREE.Vector3(0.5, -0.1, surfZ(0.5, 0.1) + 0.05), new THREE.Vector2(bs * 1.45, bs), this.def.blush * 0.85)
    }

    switch (this.def.extra) {
      case 'leaf':
        this.extras.push(this.makePart(shared.art.leaf, 0, 1, new THREE.Vector3(0.08, 1.0, 0.15), new THREE.Vector2(0.5, 0.5)))
        break
      case 'bolt':
        this.extras.push(this.makePart(shared.art.bolt, 0, 1, new THREE.Vector3(0.26, 0.95, 0.15), new THREE.Vector2(0.34, 0.34)))
        break
      case 'brows':
        this.extras.push(this.makePart(shared.art.brow, 0, 1, new THREE.Vector3(-ex, ey + 0.30, surfZ(ex, ey + 0.3) + 0.07), new THREE.Vector2(0.4, 0.24)))
        this.extras.push(this.makePart(shared.art.brow, 0, 1, new THREE.Vector3(ex, ey + 0.30, surfZ(ex, ey + 0.3) + 0.07), new THREE.Vector2(-0.4, 0.24)))
        this.extras.push(this.makePart(shared.art.bolt, 0, 1, new THREE.Vector3(0.0, 1.0, 0.15), new THREE.Vector2(0.26, 0.26)))
        break
      case 'crown':
        this.extras.push(this.makePart(shared.art.crown, 0, 1, new THREE.Vector3(0, 1.04, 0.1), new THREE.Vector2(0.62, 0.5)))
        break
      case 'aurora': {
        // constellation freckles on the brow
        for (const [fx, fy, s] of [[-0.26, 0.42, 0.12], [0.0, 0.5, 0.09], [0.27, 0.4, 0.13]] as const) {
          this.extras.push(this.makePart(shared.art.sparkle, 0, 1, new THREE.Vector3(fx, fy, surfZ(fx, fy) + 0.06), new THREE.Vector2(s, s), 0.9))
        }
        break
      }
    }
  }

  private makePart(
    tex: THREE.Texture,
    cell: number,
    cells: number,
    base: THREE.Vector3,
    scale: THREE.Vector2,
    alpha = 1,
  ): Part {
    const mat = new THREE.ShaderMaterial({
      vertexShader: partVertSrc,
      fragmentShader: partFragSrc,
      transparent: true,
      depthWrite: false,
      // mirrored parts (negative uPartScale.x) flip winding — never cull
      side: THREE.DoubleSide,
      uniforms: {
        uTime: this.uTime,
        uSeed: { value: this.seed },
        uSquash: this.uSquash,
        uContacts: this.uContacts,
        uWobble: this.uWobble,
        uPartOffset: { value: base.clone() },
        uPartScale: { value: new THREE.Vector3(scale.x, scale.y, 1) },
        uUvRect: { value: new THREE.Vector4(cell / cells, 0, 1 / cells, 1) },
        uTex: { value: tex },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uAlpha: { value: alpha },
      },
    })
    this.allMats.push(mat)
    const mesh = new THREE.Mesh(getQuad(), mat)
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    this.group.add(mesh)
    return { mesh, mat, base: base.clone(), scale: scale.clone() }
  }

  /** Birth squish: tiny → overshoot ≈1.25× → settle (damped spring). */
  pop(): void {
    this.scaleX = 0.42
    this.scaleV = 7.5
    this.uFlash.value = 0.85
    this.excite(0.12, 0.07)
  }

  excite(a2: number, a3: number): void {
    this.wAmp2 = Math.min(this.wAmp2 + a2, 0.2)
    this.wAmp3 = Math.min(this.wAmp3 + a3, 0.14)
  }

  onImpact(nx: number, ny: number, strength: number): void {
    this.pulseDir.set(nx, ny)
    this.pulseAmt = Math.min(strength * 0.00042, 0.30)
    this.pulseT = this.pulseDur
    this.excite(Math.min(strength * 0.00032, 0.12), Math.min(strength * 0.0002, 0.07))
  }

  setMood(mood: Mood, duration: number): void {
    this.mood = mood
    this.moodT = duration
  }

  private setCell(p: Part, cell: number, cells: number): void {
    ;(p.mat.uniforms.uUvRect.value as THREE.Vector4).set(cell / cells, 0, 1 / cells, 1)
  }

  /** body may be null for the held (kinematic) blob; pass position instead.
   *  snuggleDir: unit vector toward the snuggle twin — the body yearns. */
  update(
    dt: number,
    time: number,
    body: JellyBody | null,
    look: { x: number; y: number } | null,
    heldPos?: { x: number; y: number },
    snuggleDir?: { x: number; y: number } | null,
  ): void {
    this.uTime.value = time

    let posX: number, posY: number
    let velX = 0, velY = 0
    let compression = 0

    if (body) {
      posX = body.x
      posY = body.y
      velX = body.vxLast
      velY = body.vyLast
      const cs = this.uContacts.value
      for (let i = 0; i < 4; i++) {
        const c = body.contacts[i]
        if (c) {
          cs[i].set(c.nx, c.ny, Math.min(c.depth / body.r, 0.34), 1)
          compression += c.depth / body.r
        } else {
          cs[i].set(0, 0, 0, 0)
        }
      }
    } else {
      posX = heldPos?.x ?? this.group.position.x
      posY = heldPos?.y ?? this.group.position.y
      if (this.hasLast && dt > 0) {
        velX = (posX - this.lastX) / dt
        velY = (posY - this.lastY) / dt
      }
      const cs = this.uContacts.value
      for (let i = 0; i < 4; i++) cs[i].set(0, 0, 0, 0)
    }
    this.lastX = posX
    this.lastY = posY
    this.hasLast = true
    this.group.position.set(posX, posY, 0)

    // squash: impact pulse wins; otherwise stretch along velocity in the air
    if (this.pulseT > 0) {
      this.pulseT -= dt
      const k = Math.max(this.pulseT, 0) / this.pulseDur // 1 → 0 envelope
      this.uSquash.value.set(this.pulseDir.x, this.pulseDir.y, -this.pulseAmt * k)
    } else if (snuggleDir) {
      // yearning: stretch toward the twin like taffy
      const target = 0.12
      const z = this.uSquash.value.z
      this.uSquash.value.set(snuggleDir.x, snuggleDir.y, z + (target - z) * Math.min(1, dt * 8))
    } else {
      const speed = Math.hypot(velX, velY)
      if (speed > 40 && compression < 0.05) {
        const amt = Math.min(speed * 0.00016, 0.28)
        this.uSquash.value.set(velX / speed, velY / speed, amt)
      } else {
        this.uSquash.value.z *= Math.exp(-10 * dt)
      }
    }

    // wobble springs
    this.wAmp2 *= Math.exp(-5.5 * dt)
    this.wAmp3 *= Math.exp(-7 * dt)
    this.wPh2 += 28 * dt
    this.wPh3 += 46 * dt
    this.uWobble.value.set(
      this.wAmp2 > 1e-4 ? this.wAmp2 : 0, this.wPh2,
      this.wAmp3 > 1e-4 ? this.wAmp3 : 0, this.wPh3,
    )

    // birth scale spring (k=180, c=12 → ~1.25 overshoot)
    const acc = (1 - this.scaleX) * 180 - this.scaleV * 12
    this.scaleV += acc * dt
    this.scaleX += this.scaleV * dt
    this.group.scale.setScalar(this.def.r * this.scaleX)

    this.uFlash.value *= Math.exp(-6.5 * dt)

    // blinking
    let blinkY = 1
    if (this.blinkPhase > 0) {
      this.blinkPhase -= dt
      const u = 1 - Math.max(this.blinkPhase, 0) / 0.14
      blinkY = Math.max(0.08, 1 - Math.sin(Math.PI * u))
    } else {
      this.blinkTimer -= dt
      if (this.blinkTimer <= 0) {
        this.blinkPhase = 0.14
        this.blinkTimer = 2.2 + Math.random() * 3.4
      }
    }

    // mood resolution
    if (this.moodT > 0) this.moodT -= dt
    let mood: Mood = this.moodT > 0 ? this.mood : 'idle'
    if (mood === 'idle' && compression > 0.5) mood = 'squish'
    if (mood === 'idle' && this.worried) mood = 'worried'
    if (mood === 'idle' && body && body.snuggleWith !== 0) mood = 'love'

    const face = mood === 'idle'
      ? { eyeL: this.def.eyeL, eyeR: this.def.eyeR, mouth: this.def.mouth }
      : MOOD_FACE[mood]
    this.setCell(this.eyeL, face.eyeL, 8)
    this.setCell(this.eyeR, face.eyeR, 8)
    this.setCell(this.mouth, face.mouth, 8)
    const blushBoost = mood === 'love' ? 1 : this.def.blush * 0.85
    if (this.blushL) this.blushL.mat.uniforms.uAlpha.value = blushBoost
    if (this.blushR) this.blushR.mat.uniforms.uAlpha.value = blushBoost

    // pupil look: shift whole eyes subtly toward target
    let lx = 0, ly = 0
    if (look && mood !== 'sleep') {
      const dx = look.x - posX
      const dy = look.y - posY
      const d = Math.hypot(dx, dy)
      if (d > 1) {
        lx = (dx / d) * 0.05
        ly = (dy / d) * 0.05
      }
    }
    // only open-eye styles (round/half-lid/lashes) physically blink
    const blinks = (style: number) => style === 0 || style === 1 || style === 7
    for (const [part, style] of [[this.eyeL, face.eyeL], [this.eyeR, face.eyeR]] as Array<[Part, number]>) {
      const o = part.mat.uniforms.uPartOffset.value as THREE.Vector3
      o.set(part.base.x + lx, part.base.y + ly, part.base.z)
      const s = part.mat.uniforms.uPartScale.value as THREE.Vector3
      s.set(part.scale.x, part.scale.y * (mood !== 'sleep' && blinks(style) ? blinkY : 1), 1)
    }
    const mo = this.mouth.mat.uniforms.uPartOffset.value as THREE.Vector3
    mo.set(this.mouth.base.x + lx * 0.5, this.mouth.base.y + ly * 0.5, this.mouth.base.z)

    // extras sway
    for (const ex of this.extras) {
      const o = ex.mat.uniforms.uPartOffset.value as THREE.Vector3
      o.set(ex.base.x + Math.sin(time * 2.6 + this.seed) * 0.035, ex.base.y + Math.abs(Math.sin(time * 2.2 + this.seed)) * 0.02, ex.base.z)
    }

    // held blob leans with motion
    if (!body) {
      this.group.rotation.z = THREE.MathUtils.clamp(-velX * 0.00035, -0.25, 0.25)
    } else {
      this.group.rotation.z = 0
    }
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const m of this.allMats) m.dispose()
  }
}

/** Star Snack pellet: a glowing star, no face, no deformation. */
export class StarView {
  group = new THREE.Group()
  private mats: THREE.Material[] = []

  constructor(shared: SharedArt) {
    const starMat = new THREE.MeshBasicMaterial({ map: shared.art.star, transparent: true, depthWrite: false })
    const star = new THREE.Mesh(getQuad(), starMat)
    star.scale.setScalar(2.4)
    star.frustumCulled = false
    star.renderOrder = 3
    const glowMat = new THREE.MeshBasicMaterial({
      map: shared.blush, transparent: true, depthWrite: false,
      color: new THREE.Color('#FFE8B8'), blending: THREE.AdditiveBlending,
    })
    const glow = new THREE.Mesh(getQuad(), glowMat)
    glow.scale.setScalar(4.5)
    glow.frustumCulled = false
    glow.renderOrder = 2
    this.mats.push(starMat, glowMat)
    this.group.add(glow, star)
  }

  update(time: number, body: JellyBody): void {
    this.group.position.set(body.x, body.y, 0)
    this.group.scale.setScalar(body.r)
    this.group.rotation.z = Math.sin(time * 3) * 0.3
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const m of this.mats) m.dispose()
  }
}
