// Instanced particle pools: droplets (tinted), stars, hearts.
// 3 draw calls total regardless of how juicy things get.
import * as THREE from 'three'
import type { ArtAssets } from '../render/art'

const reducedMotion =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

interface P {
  alive: boolean
  x: number; y: number
  vx: number; vy: number
  life: number; maxLife: number
  size: number
  spin: number; rot: number
  gravity: number
}

class Pool {
  mesh: THREE.InstancedMesh
  parts: P[] = []
  private dummy = new THREE.Object3D()
  private color = new THREE.Color()

  constructor(tex: THREE.Texture, cap: number, parent: THREE.Object3D, tintable: boolean) {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 15
    if (tintable) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3)
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    }
    for (let i = 0; i < cap; i++) {
      this.parts.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, spin: 0, rot: 0, gravity: -1500 })
      this.dummy.position.set(0, 0, -9999)
      this.dummy.scale.setScalar(0.0001)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    parent.add(this.mesh)
  }

  spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, tint?: THREE.Color, gravity = -1500): void {
    const i = this.parts.findIndex((p) => !p.alive)
    if (i < 0) return
    const p = this.parts[i]
    p.alive = true
    p.x = x; p.y = y; p.vx = vx; p.vy = vy
    p.life = life; p.maxLife = life
    p.size = size
    p.rot = Math.random() * Math.PI * 2
    p.spin = (Math.random() - 0.5) * 6
    p.gravity = gravity
    if (tint && this.mesh.instanceColor) {
      this.color.copy(tint)
      this.mesh.setColorAt(i, this.color)
      this.mesh.instanceColor.needsUpdate = true
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]
      if (!p.alive) continue
      p.life -= dt
      if (p.life <= 0) {
        p.alive = false
        this.dummy.position.set(0, 0, -9999)
        this.dummy.scale.setScalar(0.0001)
      } else {
        p.vy += p.gravity * dt
        p.vx *= Math.pow(0.5, dt / 0.45)
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.rot += p.spin * dt
        const u = p.life / p.maxLife
        const s = p.size * (0.4 + 0.6 * u) * (u > 0.9 ? (1 - u) * 10 : 1)
        // in front of even the largest jelly (r≈166) so bursts never hide
        this.dummy.position.set(p.x, p.y, 200)
        this.dummy.rotation.z = p.rot
        this.dummy.scale.setScalar(Math.max(s, 0.001))
      }
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

export class Particles {
  private droplets: Pool
  private stars: Pool
  private hearts: Pool
  private white = new THREE.Color('#ffffff')

  constructor(scene: THREE.Scene, art: ArtAssets) {
    this.droplets = new Pool(art.droplet, 96, scene, true)
    this.stars = new Pool(art.star, 64, scene, false)
    this.hearts = new Pool(art.heart, 48, scene, false)
  }

  private count(n: number): number {
    return reducedMotion ? Math.ceil(n * 0.3) : n
  }

  /** gooey merge burst: tinted droplets + stars/hearts; scales with the chain */
  mergeBurst(x: number, y: number, r: number, tier: number, color: string, combo = 1): void {
    const tint = new THREE.Color(color).lerp(this.white, 0.25)
    const comboScale = Math.min(1 + 0.35 * (combo - 1), 2.5)
    const n = this.count(Math.round((8 + tier * 2) * comboScale))
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 120 + Math.random() * 240 + tier * 18
      this.droplets.spawn(
        x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4,
        Math.cos(a) * sp, Math.sin(a) * sp + 120,
        0.8 + Math.random() * 0.6, 14 + Math.random() * 16 + tier * 1.5, tint,
      )
    }
    const hearts = this.count(tier >= 3 ? 3 : 1)
    for (let i = 0; i < hearts; i++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6
      this.hearts.spawn(x, y + r * 0.4, Math.cos(a) * 90, 160 + Math.random() * 130, 1.1, 22 + tier * 2, undefined, -350)
    }
    if (tier >= 5) {
      for (let i = 0; i < this.count(4); i++) {
        const a = Math.random() * Math.PI * 2
        this.stars.spawn(x, y, Math.cos(a) * 220, Math.sin(a) * 220 + 80, 1.0, 20 + tier * 2, undefined, -600)
      }
    }
    if (combo >= 4) {
      // hot-chain star ring regardless of tier
      for (let i = 0; i < this.count(6); i++) {
        const a = (i / 6) * Math.PI * 2
        this.stars.spawn(x, y, Math.cos(a) * 300, Math.sin(a) * 300, 1.1, 18 + combo * 2, undefined, -500)
      }
    }
  }

  /** small tinted poof where a Dewling lands */
  landPoof(x: number, y: number, color: string, strength: number): void {
    const tint = new THREE.Color(color).lerp(this.white, 0.4)
    const n = this.count(Math.min(3 + Math.floor(strength / 600), 6))
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.15 + 0.7 * Math.random()) // up-ish fan
      const sp = 60 + Math.random() * 120
      this.droplets.spawn(x + (Math.random() - 0.5) * 30, y, Math.cos(a) * sp * (Math.random() < 0.5 ? -1 : 1), Math.sin(a) * sp, 0.5 + Math.random() * 0.3, 9 + Math.random() * 8, tint, -900)
    }
  }

  snuggleSparkle(x: number, y: number): void {
    if (Math.random() > 0.45) return
    this.hearts.spawn(x, y, (Math.random() - 0.5) * 40, 60 + Math.random() * 50, 0.8, 12, undefined, -150)
  }

  starTrail(x: number, y: number): void {
    this.stars.spawn(x + (Math.random() - 0.5) * 14, y, (Math.random() - 0.5) * 30, -20, 0.5, 12, undefined, -100)
  }

  /** Borealis celebration: shooting stars + hearts everywhere */
  celebration(x: number, y: number): void {
    for (let i = 0; i < this.count(26); i++) {
      const a = Math.random() * Math.PI
      const sp = 350 + Math.random() * 500
      this.stars.spawn(x, y, Math.cos(a) * sp * 0.7, Math.abs(Math.sin(a)) * sp, 1.6 + Math.random(), 22 + Math.random() * 18, undefined, -700)
    }
    for (let i = 0; i < this.count(14); i++) {
      const a = Math.random() * Math.PI * 2
      this.hearts.spawn(x, y, Math.cos(a) * 260, Math.sin(a) * 260 + 200, 1.4, 24, undefined, -400)
    }
  }

  update(dt: number): void {
    this.droplets.update(dt)
    this.stars.update(dt)
    this.hearts.update(dt)
  }
}
