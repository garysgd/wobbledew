// Scene: dusk-sky world, glass wishing jar, lamp dropper, postprocessing.
import * as THREE from 'three'
import {
  BloomEffect, EffectComposer, EffectPass, RenderPass,
  ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing'
import { DESIGN, PALETTE } from '../config'
import { makeSoftDot } from './textures'

const BG_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const BG_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uGlow;
uniform vec3 uMist;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 col = mix(uMid, uTop, smoothstep(0.35, 1.0, vUv.y));
  // warm lamp glow upper area
  float glow = exp(-distance(vUv, vec2(0.5, 0.96)) * 3.2);
  col = mix(col, uGlow, glow * 0.55);
  // sea of mist at the bottom
  float mist = smoothstep(0.30, 0.0, vUv.y);
  col = mix(col, uMist, mist * 0.5);

  // twinkling stars: tiny round points near cell centers (skip misty bottom)
  vec2 cellId = floor(vUv * 90.0);
  vec2 cellF = fract(vUv * 90.0) - 0.5;
  vec2 jitter = vec2(hash(cellId + 3.0), hash(cellId + 5.0)) * 0.5 - 0.25;
  float star = step(0.985, hash(cellId)) * smoothstep(0.12, 0.0, length(cellF + jitter));
  float tw = 0.5 + 0.5 * sin(uTime * (1.0 + hash(cellId + 7.0) * 2.0) + hash(cellId) * 40.0);
  col += vec3(1.0, 0.97, 0.9) * star * tw * smoothstep(0.25, 0.5, vUv.y) * 1.4;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

const GLASS_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorld;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}`

const GLASS_FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uBack; // 1 = inner wall pass
uniform vec3 uRipple; // x: origin y, y: age, z: strength
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorld;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(-vViewPos);
  float fres = pow(1.0 - abs(dot(N, V)), 3.5);
  float a = mix(0.02, 0.30, fres);
  // bonk ripple: bright ring expanding from impact height
  float ringR = uRipple.y * 900.0;
  float ring = exp(-abs(distance(vWorld.y, uRipple.x) - ringR) * 0.02) * exp(-uRipple.y * 4.0) * uRipple.z;
  a += ring * 0.25;
  vec3 col = uTint + vec3(1.0) * ring * 0.4;
  if (uBack > 0.5) a *= 0.4;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

const reducedMotion =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export class SceneCtx {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera: THREE.PerspectiveCamera
  composer: EffectComposer

  lamp = new THREE.Group()
  private lampLight: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  private strand: THREE.Line
  private strandGeo = new THREE.BufferGeometry()
  private aimLine: THREE.Line
  private aimGeo = new THREE.BufferGeometry()
  private loseLine: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private bgMat: THREE.ShaderMaterial
  private glassMats: THREE.ShaderMaterial[] = []
  private bokeh: THREE.Points
  private bokehVel: Float32Array

  private trauma = 0
  private raycaster = new THREE.Raycaster()
  private planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  private v3 = new THREE.Vector3()
  private rippleAge = 99

  private dprCap: number

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.toneMapping = THREE.NoToneMapping
    // iPadOS 13+ reports a Macintosh UA — detect via touch points
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    this.dprCap = mobile ? 1.5 : 2

    this.camera = new THREE.PerspectiveCamera(26, 1, 100, 6000)

    // HalfFloat needs render-to-float support; fall back gracefully on old GPUs
    const gl = this.renderer.getContext()
    const halfFloatOk = this.renderer.capabilities.isWebGL2 &&
      (!!gl.getExtension('EXT_color_buffer_half_float') || !!gl.getExtension('EXT_color_buffer_float'))
    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: halfFloatOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
      multisampling: mobile ? 0 : 4,
    })
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new EffectPass(
      this.camera,
      new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.72, luminanceSmoothing: 0.25, intensity: 0.6 }),
      new VignetteEffect({ offset: 0.28, darkness: 0.28 }),
      new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
    ))

    // ------------------------------------------------ background
    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: BG_VERT,
      fragmentShader: BG_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uTop: { value: new THREE.Color(PALETTE.bgTop) },
        uMid: { value: new THREE.Color(PALETTE.bgMid) },
        uGlow: { value: new THREE.Color(PALETTE.bgGlow) },
        uMist: { value: new THREE.Color(PALETTE.mist).multiplyScalar(0.55) },
      },
      depthWrite: false,
    })
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(7000, 5000), this.bgMat)
    bg.position.set(0, DESIGN.frameCenterY, -1200)
    bg.renderOrder = -10
    this.scene.add(bg)

    // drifting bokeh dust
    const N_BOKEH = 50
    const pos = new Float32Array(N_BOKEH * 3)
    this.bokehVel = new Float32Array(N_BOKEH)
    for (let i = 0; i < N_BOKEH; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 1600
      pos[i * 3 + 1] = Math.random() * 1400 - 100
      pos[i * 3 + 2] = -200 - Math.random() * 500
      this.bokehVel[i] = 6 + Math.random() * 18
    }
    const bokehGeo = new THREE.BufferGeometry()
    bokehGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.bokeh = new THREE.Points(bokehGeo, new THREE.PointsMaterial({
      map: makeSoftDot(), size: 26, transparent: true, opacity: 0.35,
      color: new THREE.Color('#cfd8ff'), depthWrite: false, blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }))
    this.bokeh.renderOrder = -9
    this.bokeh.frustumCulled = false
    this.scene.add(this.bokeh)

    // ------------------------------------------------ lights (for std materials)
    this.scene.add(new THREE.HemisphereLight('#8fa0ff', '#2e2a4a', 1.0))
    const key = new THREE.DirectionalLight('#ffe8c8', 1.2)
    key.position.set(400, 900, 600)
    this.scene.add(key)

    // ------------------------------------------------ glass jar (lathe, 2 passes)
    const HW = DESIGN.jarHalfWidth
    const glassR = HW + 22
    const profile: THREE.Vector2[] = []
    profile.push(new THREE.Vector2(0, -16))
    profile.push(new THREE.Vector2(glassR * 0.55, -16))
    profile.push(new THREE.Vector2(glassR * 0.92, -8))
    profile.push(new THREE.Vector2(glassR, 30))
    for (let i = 1; i <= 8; i++) {
      const t = i / 8
      profile.push(new THREE.Vector2(glassR + t * t * 14, 30 + t * (DESIGN.jarTopY + 14 - 30)))
    }
    const latheGeo = new THREE.LatheGeometry(profile, 48)
    const mkGlass = (back: boolean) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: GLASS_VERT,
        fragmentShader: GLASS_FRAG,
        transparent: true,
        depthWrite: false,
        side: back ? THREE.BackSide : THREE.FrontSide,
        uniforms: {
          uTint: { value: new THREE.Color(PALETTE.glass).multiplyScalar(0.85) },
          uBack: { value: back ? 1 : 0 },
          uRipple: { value: new THREE.Vector3(0, 99, 0) },
        },
      })
      this.glassMats.push(m)
      return m
    }
    // flatten the jar in z: less looming front rim, more 2.5D readability
    const jarBack = new THREE.Mesh(latheGeo, mkGlass(true))
    jarBack.renderOrder = -1
    jarBack.scale.z = 0.55
    const jarFront = new THREE.Mesh(latheGeo, mkGlass(false))
    jarFront.renderOrder = 20
    jarFront.scale.z = 0.55
    this.scene.add(jarBack, jarFront)

    // glowing rim ring (catches bloom)
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(glassR + 12, 9, 12, 64),
      new THREE.MeshStandardMaterial({
        color: PALETTE.lamp, emissive: new THREE.Color(PALETTE.lamp).multiplyScalar(0.5),
        roughness: 0.35, metalness: 0.1,
      }),
    )
    rim.position.y = DESIGN.jarTopY + 14
    rim.rotation.x = Math.PI / 2
    rim.scale.y = 0.55 // match flattened jar depth
    this.scene.add(rim)

    // pedestal: soft dark platform under the jar
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(glassR + 90, glassR + 130, 70, 48),
      new THREE.MeshStandardMaterial({ color: '#27233f', roughness: 0.9 }),
    )
    pedestal.position.y = -52
    this.scene.add(pedestal)

    // ------------------------------------------------ lamp dropper + taffy strand
    this.lampLight = new THREE.Mesh(
      new THREE.SphereGeometry(22, 20, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lamp).multiplyScalar(1.6) }),
    )
    const hood = new THREE.Mesh(
      new THREE.ConeGeometry(36, 36, 24),
      new THREE.MeshStandardMaterial({ color: '#3d3660', roughness: 0.6 }),
    )
    hood.position.y = 32
    this.lamp.add(this.lampLight, hood)
    this.lamp.position.set(0, DESIGN.dropY + 90, 0)
    this.scene.add(this.lamp)

    const strandMat = new THREE.LineBasicMaterial({ color: PALETTE.pink, transparent: true, opacity: 0.85 })
    this.strandGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    this.strand = new THREE.Line(this.strandGeo, strandMat)
    this.strand.frustumCulled = false
    this.scene.add(this.strand)

    const aimMat = new THREE.LineDashedMaterial({
      color: PALETTE.pink, transparent: true, opacity: 0.4, dashSize: 14, gapSize: 14,
    })
    this.aimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    this.aimGeo.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(2), 1))
    this.aimLine = new THREE.Line(this.aimGeo, aimMat)
    this.aimLine.frustumCulled = false
    this.scene.add(this.aimLine)

    // ------------------------------------------------ lose line (in front of blobs)
    this.loseLine = new THREE.Mesh(
      new THREE.PlaneGeometry(HW * 2, 6),
      new THREE.MeshBasicMaterial({ color: PALETTE.danger, transparent: true, opacity: 0, depthTest: false }),
    )
    this.loseLine.position.set(0, DESIGN.loseLineY, 180)
    this.loseLine.renderOrder = 18
    this.scene.add(this.loseLine)

    this.onResize()
    window.addEventListener('resize', () => this.onResize())
    window.visualViewport?.addEventListener('resize', () => this.onResize())
  }

  onResize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.dprCap))
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    // dolly so the design frame always fits
    const halfFovTan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const dH = DESIGN.frameH / 2 / halfFovTan
    const dW = DESIGN.frameW / 2 / (halfFovTan * this.camera.aspect)
    const d = Math.max(dH, dW)
    this.camera.position.set(0, DESIGN.frameCenterY, d)
    this.camera.lookAt(0, DESIGN.frameCenterY, 0)
    this.camera.far = d + 2600 // background plane sits at z=-1200
    this.camera.updateProjectionMatrix()
  }

  /** screen px → world point on the z=0 gameplay plane */
  unproject(clientX: number, clientY: number): { x: number; y: number } {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const p = new THREE.Vector3()
    this.raycaster.ray.intersectPlane(this.planeZ, p)
    return { x: p.x, y: p.y }
  }

  /** world point → CSS px (for DOM score popups) */
  project(x: number, y: number): { x: number; y: number } {
    this.v3.set(x, y, 0).project(this.camera)
    return {
      x: (this.v3.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.v3.y * 0.5 + 0.5) * window.innerHeight,
    }
  }

  addShake(trauma: number): void {
    if (reducedMotion) return
    this.trauma = Math.min(1, this.trauma + trauma)
  }

  jarRipple(y: number): void {
    this.rippleAge = 0
    for (const m of this.glassMats) {
      ;(m.uniforms.uRipple.value as THREE.Vector3).set(y, 0, 1)
    }
  }

  /** held blob support: update lamp x, strand + aim line; pass null to hide.
   *  armed = Star Snack is armed → the dropper glows gold. */
  updateDropper(x: number | null, blobY: number, blobR: number, stackTopY: number, armed = false): void {
    const show = x !== null
    this.strand.visible = show
    this.aimLine.visible = show
    this.lamp.visible = true
    if (x === null) return
    const tint = armed ? PALETTE.lamp : PALETTE.pink
    ;(this.strand.material as THREE.LineBasicMaterial).color.set(tint)
    ;(this.aimLine.material as THREE.LineDashedMaterial).color.set(tint)
    this.lamp.position.x += (x - this.lamp.position.x) * 0.25
    const sp = this.strandGeo.getAttribute('position') as THREE.BufferAttribute
    sp.setXYZ(0, this.lamp.position.x, this.lamp.position.y - 16, 0)
    sp.setXYZ(1, x, blobY + blobR * 0.7, 0)
    sp.needsUpdate = true
    const top = blobY - blobR * 1.05
    const bottom = Math.min(stackTopY, blobY - blobR)
    const ap = this.aimGeo.getAttribute('position') as THREE.BufferAttribute
    ap.setXYZ(0, x, top, 0)
    ap.setXYZ(1, x, bottom, 0)
    ap.needsUpdate = true
    // 2-point line: write dash distances directly, no per-frame allocation
    const ld = this.aimGeo.getAttribute('lineDistance') as THREE.BufferAttribute
    ld.setX(0, 0)
    ld.setX(1, Math.abs(top - bottom))
    ld.needsUpdate = true
  }

  /** lamp recoil when the strand releases a Dewling */
  lampKick(): void {
    this.lampKickY = 16
  }
  private lampKickY = 0

  setLoseLineDanger(visible: boolean, danger: number, time: number): void {
    // danger 0..1 escalates to a hard 4 Hz pulse at full opacity
    const pulse = danger > 0 ? 0.6 + 0.4 * Math.sin(time * 25) : 1
    const target = visible ? (0.22 + danger * 0.78) * pulse : 0
    const m = this.loseLine.material
    m.opacity += (target - m.opacity) * 0.2
  }

  /** bedtime: dim the lamp to a night-light */
  setLampDim(dim: boolean): void {
    this.lampLight.material.color.set(dim ? '#7a6a58' : '#ffe8b8')
    if (!dim) this.lampLight.material.color.multiplyScalar(1.6)
  }

  render(dt: number, time: number): void {
    this.bgMat.uniforms.uTime.value = time

    // lamp recoil spring-back
    if (this.lampKickY > 0.1) {
      this.lampKickY *= Math.exp(-6 * dt)
      this.lamp.position.y = DESIGN.dropY + 90 + this.lampKickY
    } else {
      this.lamp.position.y = DESIGN.dropY + 90
    }

    // bokeh drift
    const bp = this.bokeh.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < this.bokehVel.length; i++) {
      let y = bp.getY(i) + this.bokehVel[i] * dt
      if (y > 1400) y = -120
      bp.setY(i, y)
    }
    bp.needsUpdate = true

    // glass ripple decay
    if (this.rippleAge < 2) {
      this.rippleAge += dt
      for (const m of this.glassMats) {
        ;(m.uniforms.uRipple.value as THREE.Vector3).y = this.rippleAge
      }
    }

    // trauma shake
    if (this.trauma > 0.001) {
      this.trauma = Math.max(0, this.trauma - 1.3 * dt)
      const s = this.trauma * this.trauma
      const ox = (Math.random() * 2 - 1) * 14 * s
      const oy = (Math.random() * 2 - 1) * 10 * s
      this.camera.position.x = ox
      this.camera.position.y = DESIGN.frameCenterY + oy
      this.camera.rotation.z = (Math.random() * 2 - 1) * 0.012 * s
    } else {
      this.camera.position.x = 0
      this.camera.position.y = DESIGN.frameCenterY
      this.camera.rotation.z = 0
    }

    this.composer.render(dt)
  }
}
