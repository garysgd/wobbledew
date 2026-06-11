// Runtime-generated textures: grayscale matcap (the entire jelly shading
// model), the eye atlas, blush spot, and soft particle dot.
import * as THREE from 'three'

function canvasTex(size: [number, number], draw: (c: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = size[0]
  cv.height = size[1]
  const c = cv.getContext('2d')!
  draw(c)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.anisotropy = 4
  return tex
}

/** Grayscale matcap: key light upper-left, hot spec, bottom bounce, dark rim. */
export function makeMatcap(): THREE.CanvasTexture {
  return canvasTex([256, 256], (c) => {
    const g0 = c.createRadialGradient(128, 138, 20, 128, 132, 158)
    g0.addColorStop(0, '#686868')
    g0.addColorStop(0.7, '#3e3e3e')
    g0.addColorStop(1, '#161616')
    c.fillStyle = g0
    c.fillRect(0, 0, 256, 256)

    const key = c.createRadialGradient(95, 84, 6, 98, 90, 86)
    key.addColorStop(0, 'rgba(230,230,230,0.9)')
    key.addColorStop(0.5, 'rgba(180,180,180,0.35)')
    key.addColorStop(1, 'rgba(180,180,180,0)')
    c.fillStyle = key
    c.fillRect(0, 0, 256, 256)

    const spec = c.createRadialGradient(86, 72, 2, 86, 74, 30)
    spec.addColorStop(0, 'rgba(255,255,255,1)')
    spec.addColorStop(0.45, 'rgba(255,255,255,0.85)')
    spec.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = spec
    c.fillRect(0, 0, 256, 256)

    const bounce = c.createRadialGradient(132, 218, 10, 132, 212, 90)
    bounce.addColorStop(0, 'rgba(190,190,190,0.5)')
    bounce.addColorStop(1, 'rgba(190,190,190,0)')
    c.fillStyle = bounce
    c.fillRect(0, 0, 256, 256)
  }, false)
}

const INK = '#38203A'

/** 8-cell eye atlas (1024×128): 0 round-glossy, 1 half-lid, 2 happy-arc,
 *  3 squint '>', 4 sleeping, 5 starry, 6 wink-closed, 7 lashes */
export function makeEyeAtlas(): THREE.CanvasTexture {
  return canvasTex([1024, 128], (c) => {
    const cell = (i: number, draw: () => void) => {
      c.save()
      c.translate(i * 128, 0)
      draw()
      c.restore()
    }
    const glossyBall = () => {
      c.fillStyle = INK
      c.beginPath()
      c.arc(64, 64, 40, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = 'rgba(255,255,255,0.95)'
      c.beginPath()
      c.arc(50, 50, 13, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = 'rgba(255,255,255,0.65)'
      c.beginPath()
      c.arc(76, 80, 6, 0, Math.PI * 2)
      c.fill()
    }
    cell(0, glossyBall)
    cell(1, () => {
      // half-lid: lower bulge with a flat-droopy top
      c.fillStyle = INK
      c.beginPath()
      c.moveTo(26, 66)
      c.quadraticCurveTo(64, 54, 102, 66)
      c.arc(64, 66, 38, 0, Math.PI)
      c.closePath()
      c.fill()
      c.fillStyle = 'rgba(255,255,255,0.8)'
      c.beginPath()
      c.arc(50, 78, 8, 0, Math.PI * 2)
      c.fill()
    })
    cell(2, () => {
      // happy upper arc ∩
      c.strokeStyle = INK
      c.lineWidth = 15
      c.lineCap = 'round'
      c.beginPath()
      c.arc(64, 92, 40, Math.PI * 1.12, Math.PI * 1.88)
      c.stroke()
    })
    cell(3, () => {
      // squint '>'
      c.strokeStyle = INK
      c.lineWidth = 14
      c.lineCap = 'round'
      c.lineJoin = 'round'
      c.beginPath()
      c.moveTo(36, 38)
      c.lineTo(86, 64)
      c.lineTo(36, 90)
      c.stroke()
    })
    cell(4, () => {
      // sleeping lower arc ‿
      c.strokeStyle = INK
      c.lineWidth = 13
      c.lineCap = 'round'
      c.beginPath()
      c.arc(64, 48, 36, Math.PI * 0.15, Math.PI * 0.85)
      c.stroke()
    })
    cell(5, () => {
      // starry-eyed
      c.fillStyle = '#FFE8B8'
      c.beginPath()
      const spikes = 4
      for (let k = 0; k < spikes * 2; k++) {
        const ang = (k * Math.PI) / spikes - Math.PI / 2
        const rad = k % 2 === 0 ? 42 : 16
        const x = 64 + Math.cos(ang) * rad
        const y = 64 + Math.sin(ang) * rad
        k === 0 ? c.moveTo(x, y) : c.lineTo(x, y)
      }
      c.closePath()
      c.fill()
      c.fillStyle = '#FFFFFF'
      c.beginPath()
      c.arc(64, 64, 9, 0, Math.PI * 2)
      c.fill()
    })
    cell(6, () => {
      // wink: gentle closed curve
      c.strokeStyle = INK
      c.lineWidth = 13
      c.lineCap = 'round'
      c.beginPath()
      c.arc(64, 50, 30, Math.PI * 0.2, Math.PI * 0.8)
      c.stroke()
    })
    cell(7, () => {
      glossyBall()
      // long curled lashes
      c.strokeStyle = INK
      c.lineWidth = 7
      c.lineCap = 'round'
      for (const [a1, a2] of [[-1.25, -1.45], [-0.95, -1.05], [-0.65, -0.68]]) {
        c.beginPath()
        c.moveTo(64 + Math.cos(a1) * 40, 64 + Math.sin(a1) * 40)
        c.quadraticCurveTo(
          64 + Math.cos(a2) * 58, 64 + Math.sin(a2) * 58,
          64 + Math.cos(a2 + 0.18) * 66, 64 + Math.sin(a2 + 0.18) * 66,
        )
        c.stroke()
      }
    })
  })
}

export function makeBlush(): THREE.CanvasTexture {
  return canvasTex([128, 128], (c) => {
    const g = c.createRadialGradient(64, 64, 4, 64, 64, 58)
    g.addColorStop(0, 'rgba(255,123,156,0.85)')
    g.addColorStop(0.6, 'rgba(255,123,156,0.45)')
    g.addColorStop(1, 'rgba(255,123,156,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 128, 128)
  })
}

export function makeSoftDot(): THREE.CanvasTexture {
  return canvasTex([64, 64], (c) => {
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 30)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 64, 64)
  })
}
