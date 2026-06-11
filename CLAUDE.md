# Wobbledew

A Suika-like (watermelon game) jelly merge puzzle for the web. *"Every wish starts as a wobble."*
Drop **Dewlings** (living jelly spirits) into a lighthouse keeper's glass wishing jar; twins snuggle
and merge up an 11-tier chain ending in **Borealis**, the aurora sky-whale. Game over is "bedtime."

## Tech stack

- **Vite + TypeScript** (strict), no framework — plain DOM for HUD/overlays
- **Three.js** for rendering, **pmndrs `postprocessing`** for bloom/vignette/ACES
- Custom deterministic **2D verlet physics** (no physics lib)
- Custom **GLSL** jelly shaders (matcap + fresnel + fake SSS; vertex squash/wobble/contact-flattening)
- **Generated real assets**: `.wav` SFX/music synthesized by `tools/gen-audio.mjs` (zero deps),
  hand-authored SVGs in `assets/svg/`, runtime canvas textures (matcap, eye atlas)

## Commands

```bash
npm run dev         # Vite dev server
npm run build       # tsc --noEmit + vite build → dist/
npm run typecheck   # tsc --noEmit only
npm run gen:assets  # regenerate public/audio/*.wav (deterministic, seeded)
python3 -m http.server 8899 --directory dist   # serve the production build
```

## Architecture (2.5D)

Physics is a y-up 2D verlet circle solver ([src/physics.ts](src/physics.ts)) driving 3D jelly meshes.
All "soft body" deformation is **visual-only**, computed in the vertex shader from real per-frame
contact data (≤4 contacts/blob: direction + depth). This gives jelly feel with zero sim instability.

- [src/config.ts](src/config.ts) — every tunable: tier table (radii/colors/faces), rules, palette.
  Canon Suika numbers: radius ratios ×21 base, triangular scores, uniform 1–5 spawns, 0.75 s
  lose-line grace, merge on first contact. Twists: **Snuggle Seek** (same-tier attraction) and
  **Star Snack** (banked pellet upgrades a stuck blob, every 8 merges).
- [src/game.ts](src/game.ts) — state machine (title/playing/bedtime), drops/re-arm (contact-gated
  with 1.0 s fallback), merges, combos (juice-only, canon scoring), hit-stop (physics-only; combo
  and lose timers pause with it), lose-line escalation (heartbeat + pulse), bedtime slow-mo settle.
- [src/render/jelly.ts](src/render/jelly.ts) — `BlobView`: body mesh + face-part quads (eyes/mouth/
  blush/extras) that share the body's deformation uniform objects so faces hug the jelly. Part
  materials are `DoubleSide` (right-side parts mirror via negative x-scale → flipped winding).
- [src/render/scene.ts](src/render/scene.ts) — camera dolly-fit to design frame (640-wide jar),
  dusk-sky shader bg, two-pass fresnel glass jar (NO transmission — mobile), lamp dropper + taffy
  strand, composer (HalfFloat probed with byte fallback, 4× MSAA desktop, DPR cap 2/1.5).
- [src/physics.ts](src/physics.ts) — 8 substeps, 3 relaxation passes, equal mass, restitution 0.15,
  96 % pair slack (visible squish). **Verlet velocity is per-substep**: any velocity read/write must
  scale by `h = 1/60/SUBSTEPS` (see `velocityInto`, `impulse` — 1 unit ≈ 480 px/s!).
- [src/audio.ts](src/audio.ts) — AudioContext created **synchronously inside the first gesture**
  (iOS), decode after; pentatonic combo pitch ladder; music duck/fade; visibilitychange suspend.
- [src/ui.ts](src/ui.ts), [index.html](index.html) — DOM HUD; chains accumulate into ONE growing
  gold popup; overlays use class `hidden` + delayed `display:none` (CSS transitions don't advance
  under headless virtual time).
- [src/demo.ts](src/demo.ts) — `?demo=1` deterministic autoplay; writes status to `#demostat`.

## Headless verification recipe (important)

Headless Chrome `--virtual-time-budget` pumps **timers but starves rAF**, so demo mode steps game
logic on a `setInterval` and presents frames in rAF (canvas only composites during BeginFrame):

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --hide-scrollbars --window-size=720,1100 \
  --virtual-time-budget=20000 --screenshot=out.png "http://localhost:8899/?demo=1"
# runtime state:  --dump-dom ... | grep -oE 'demo ticks=[^<]*'   (also #errlog, #loopstat)
```

## Conventions

- All gameplay coordinates are design-space px (jar interior 640 wide, floor y=0, y-up).
- No per-frame allocations in hot paths; shared geometries; uniform *value objects* are shared
  across a blob's materials (mutate `.value`, never reassign the object).
- Input taps on `button, .overlay` never aim/drop (see `fromUI` in [src/input.ts](src/input.ts)).
- `prefers-reduced-motion` disables shake/hit-stop and cuts particles to 30 %.
- Plan/design record: [plans/2026-06-11-jelly-merge-game.md](plans/2026-06-11-jelly-merge-game.md).
