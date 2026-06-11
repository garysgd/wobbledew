// Unified pointer + keyboard input with a 100 ms drop buffer so fast taps
// never feel eaten (brief requirement). Taps on UI elements never aim or drop.
import { DESIGN } from './config'

function fromUI(e: Event): boolean {
  const t = e.target
  return t instanceof Element && t.closest('button, .overlay') !== null
}

export class Input {
  /** aim x in world coords */
  worldX = 0
  private dropRequestAt = -1
  private now = 0
  private keyboardX = 0
  private usingKeyboard = false
  private keysDown = new Set<string>()

  attach(el: HTMLElement, unproject: (cx: number, cy: number) => { x: number; y: number }): void {
    const aim = (e: PointerEvent) => {
      if (fromUI(e)) return
      this.usingKeyboard = false
      this.worldX = unproject(e.clientX, e.clientY).x
    }
    el.addEventListener('pointermove', aim)
    el.addEventListener('pointerdown', aim)
    el.addEventListener('pointerup', (e) => {
      if (fromUI(e)) return
      aim(e)
      this.dropRequestAt = this.now
    })
    window.addEventListener('keydown', (e) => {
      // never hijack focused UI buttons
      if (e.target instanceof Element && e.target.closest('button')) return
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        this.usingKeyboard = true
        this.keysDown.add(e.code)
        e.preventDefault()
      } else if (e.code === 'Space' || e.code === 'Enter') {
        this.dropRequestAt = this.now
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code))
    window.addEventListener('blur', () => this.keysDown.clear())
  }

  update(dt: number): void {
    this.now += dt
    if (this.usingKeyboard) {
      const speed = 520
      if (this.keysDown.has('ArrowLeft')) this.keyboardX -= speed * dt
      if (this.keysDown.has('ArrowRight')) this.keyboardX += speed * dt
      this.keyboardX = Math.max(-DESIGN.jarHalfWidth, Math.min(DESIGN.jarHalfWidth, this.keyboardX))
      this.worldX = this.keyboardX
    } else {
      this.keyboardX = this.worldX
    }
  }

  /** demo/autoplay hooks */
  simulate(worldX: number): void {
    this.usingKeyboard = false
    this.worldX = worldX
  }

  requestDrop(): void {
    this.dropRequestAt = this.now
  }

  /** discard any buffered drop (called on state transitions) */
  clearDrop(): void {
    this.dropRequestAt = -1
  }

  /** true once if a drop was requested within the last 100 ms */
  consumeDrop(): boolean {
    if (this.dropRequestAt >= 0 && this.now - this.dropRequestAt <= 0.1) {
      this.dropRequestAt = -1
      return true
    }
    if (this.dropRequestAt >= 0 && this.now - this.dropRequestAt > 0.1) this.dropRequestAt = -1
    return false
  }
}
