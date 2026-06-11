# Plan: World-Class Jelly Merge Game (Suika-like, web)

**Date:** 2026-06-11
**Status:** ✅ SHIPPED — **WOBBLEDEW** ("Every wish starts as a wobble."). Brief from research workflow
`wf_5355e1dd-ce1`; built and verified per the plan; multi-agent review workflow `wf_1fb07c2d-d09`
(53 agents, 5 lenses + adversarial verification) confirmed 45 findings — all criticals/majors fixed
(input leak from UI taps, backface-culled right eyes, iOS audio unlock race, pop-impulse unit error,
drop re-arm timing, bedtime freeze, lose telegraph, chain-popup clutter, + minors). Final state
verified via headless gameplay screenshots + runtime stats (`shots/`).

## Final design brief (from research workflow)

- **Theme:** Living jelly spirits ("Dewlings") raised in a lighthouse keeper's glass wishing jar on a
  drifting cloud-isle. Dusk-indigo sky (#2E2A4A) makes the candy blobs + bloom pop. Game over = bedtime
  (lamp dims, everyone falls asleep) — never failure-coded.
- **Chain (11):** Plip #FFB3D1 → Squibble #FF9457 → Bumble #FFDE6B → Sprigg #9FE05A → Nori #4FD8C4 →
  Lumi #6FC4FF → Grumble #6F6AF2 → Floof #C49AFF → Plumpa #F06FD0 → Pomp #E0436E → **Borealis #4A4E9E**
  (aurora sky-whale w/ animated #8FFAE1 sheen — the legendary tier).
- **Canon numbers:** radius ratios [1.00,1.32,1.84,2.16,2.73,3.44,3.97,4.86,5.44,6.65,7.89] × base 21 on a
  640-wide board; triangular scores [1,3,6,10,15,21,28,36,45,55,66] awarded per merge of two tier-n; spawn
  uniform 1/5 over tiers 1–5; drop re-arms on dropped blob's first contact (500 ms fallback, 100 ms input
  buffer); lose line 11 % below jar top, free-falling blobs exempt, 0.75 s continuous-overlap grace, merges
  resolve before the game-over check; equal mass all tiers, restitution ≈0.15, low friction, 8 substeps;
  merge on FIRST contact (zero latency); Borealis pair = both poof (comeback valve).
- **Twist 1 — Snuggle Seek:** nearest same-tier pair with surface gap < 0.5×min(r) gets weak mutual
  attraction (~13 % gravity), disabled in free fall; faces blush/lean → heart-squish merge.
- **Twist 2 — Star Snack:** every 8 merges the lamp banks a star pellet (max 1); drop it to upgrade the
  first-touched Dewling one tier in place. No score — pure rescue for the buried-wrong-tier frustration.
- **Juice (P0/P1):** landing squash 1.12 (180 ms recover), merge overshoot 1.25× damped spring, tier-pitched
  pentatonic merge squelch (+1 step per chain link, 800 ms window), faces are physics readouts (squint ∝
  compression, pupils track), taffy-strand drop anticipation, hit-stop by tier band (physics only), shake
  only tier ≥6, particles 8+2×tier, floating score text.
- **Rendering:** pmndrs `postprocessing` (Bloom mipmapBlur + Vignette + ACES in one EffectPass,
  HalfFloatType); NO MeshPhysicalMaterial transmission — two-pass fresnel-alpha glass; faces as atlas quads
  (brief's endorsed fallback) sharing the body's deformation uniforms; DPR cap 2/1.5; headless flags
  `--use-angle=swiftshader --enable-unsafe-swiftshader` + gate on `window.__renderReady`.

## Context

Build a cute, colorful, original Suika-style merge puzzle for the web. The twist: **everything is jelly** —
blobs squish, wobble, flatten against each other and the jar, and have living faces. Target quality bar:
"world class" — real engineering (Vite + TypeScript + Three.js), real generated assets (SVG art +
procedurally synthesized WAV audio written to disk by a Node pipeline), custom GLSL shaders, bloom
postprocessing. Must run great on desktop + mobile browsers and be trivially hostable (static `dist/`).

## Approach (high level)

**2.5D architecture:** gameplay physics is a deterministic custom 2D verlet circle solver (the thing that
makes Suika merges fair and stable). Each circle drives a lush 3D jelly mesh rendered by Three.js with a
custom ShaderMaterial. Soft-body is *visual* (vertex-shader deformation from real contact data), so we get
the jelly look with zero physics instability.

- Renderer: Three.js (latest), perspective camera with mild FOV (~28°) looking straight at the jar plane.
- Shading: generated matcap + fresnel rim + fake SSS light-wrap + per-tier hue, in one ShaderMaterial.
- Deformation (vertex shader): squash/stretch along velocity, contact flattening (uniform array of up to 4
  contacts: planar direction + depth), damped-sine impact wobble, idle breathing.
- Faces: small meshes/sprite-quads (eyes, pupils, mouth, blush) parented to each blob; blink timers, pupils
  track targets (held blob / nearest same-tier neighbor), squint when compressed, joy on merge.
- Jar: glass look — cheap fresnel-alpha fake first; MeshPhysicalMaterial transmission only if perf allows.
- Postprocessing: bloom (subtle) + vignette; ACES tone mapping; DPR capped at 2.
- HUD/overlays: DOM + CSS (score, best, next preview, combo text, title & game-over screens), cute rounded
  font (Google Fonts `Fredoka`, graceful system fallback).

## Physics spec (custom, `src/physics.ts`)

- Verlet integration, fixed timestep 1/60 with accumulator (clamp frame dt ≤ 50 ms), 4 substeps,
  ~6 constraint relaxation passes per substep. O(n²) pair checks are fine (≤ ~90 blobs).
- Gravity ~2600 design-px/s²; per-substep velocity damping ~0.9985; extra horizontal damping on floor
  contact (settle, no eternal sliding).
- Pair resolution to `0.96 × (ri+rj)` separation (slight overlap = visual squish), mass ∝ r².
- Walls/floor clamp with the same slack so blobs flatten visibly against glass.
- Merge rule: same tier + dist < `0.985 × (ri+rj)` + both alive + spawn age > 120 ms → merge at weighted
  midpoint into tier+1; momentum-averaged velocity; small radial impulse to neighbors ("pop" relief).
  One merge per blob per frame (mark-used set). Final-tier pair → celebration supernova (both vanish, bonus).
- Contact data (strongest ≤ 4 per blob: direction, depth) is exported every frame → shader uniforms + face
  squint logic + landing wobble/SFX triggers (rate-limited impact detector via per-frame Δv).
- Game over: lose-line near jar top; a settled blob whose top stays above the line accumulates timer;
  > ~2 s → game over. Pulsing warning + worried faces when threatened.

## Game rules (numbers finalized from research; defaults below)

- 11 tiers; radius ratio ≈ ×1.17–1.25 per tier (merged result ≪ combined area → relief). Design space
  ~520×760, jar interior ~460 wide, biggest tier r ≈ 145.
- Scoring: triangular numbers — creating tier *t* (1-indexed) awards `t(t+1)/2 × comboMultiplier`.
  Combo increments when merges happen within ~1.2 s windows; cap multiplier.
- Droppable tiers 1–5, weighted to small (≈ [32, 26, 20, 14, 8]); drop cooldown ~500 ms; next-preview shown.
- Held blob is kinematic, dangles/follows pointer with spring; release/click to drop (pointer events, works
  for touch + mouse).

## Files to create

```
package.json, tsconfig.json, vite.config.ts, index.html
src/main.ts            — boot, loop, fixed-timestep accumulator
src/config.ts          — tier table (names/colors/faces from brief), all tunables
src/physics.ts         — verlet solver, contacts, merge detection
src/game.ts            — state machine (title/playing/over), scoring, combos, lose-line, persistence
src/render/scene.ts    — renderer, camera, lights, background, jar, postprocessing
src/render/jelly.ts    — ShaderMaterial factory, matcap generation, BlobMesh (mesh + face rig)
src/shaders/jelly.vert.glsl, src/shaders/jelly.frag.glsl  (imported `?raw`)
src/fx/particles.ts    — droplets/stars/confetti pools, floating score text (DOM)
src/audio.ts           — WAV asset loader + WebAudio playback w/ pitch jitter; music loop; mute prefs
src/input.ts           — pointer handling, coordinate transform
src/ui.ts              — DOM HUD, overlays, evolution chart
src/demo.ts            — `?demo=1` autoplay for headless screenshots; window error capture
tools/gen-audio.mjs    — Node script: synthesizes all SFX + music loop, writes real .wav files to public/audio/
public/audio/*.wav     — generated real audio assets
assets/svg/*.svg       — hand-authored art (face parts sheet, particles, logo) loaded as textures
CLAUDE.md              — project docs (end of task)
```

## Asset pipeline ("real assets")

- `tools/gen-audio.mjs`: pure-Node 16-bit PCM WAV writer; synthesizes plop (per-tier pitch), merge
  squelch+bloop (tier-scaled), sparkle arpeggio, new-discovery fanfare, game-over slide, UI tick, and a
  gentle seamless music-box pentatonic loop with baked feedback-delay reverb. Run via `npm run gen:assets`;
  outputs committed under `public/audio/`.
- SVG sprites: mouths/eyes/blush variants, star/droplet/heart particles, logo — rasterized to textures at
  load time (native `Image` decode), so art is real, editable files.
- Matcap + background gradient textures: generated at runtime via small canvas (documented in code).

## Juice checklist (min bar)

Squash on landing, wobble waves, gooey merge burst + droplets, floating `+N` score text, combo escalation
text/pitch, screen-shake (tiny, reduced-motion aware), blink/look-at faces, squint under pressure, worried
faces above lose-line, discovery banner + fanfare for first-time tiers, legendary final-tier celebration
(confetti + flash + fanfare), haptics via `navigator.vibrate` on mobile merges, idle breathing, hover dangle
on held blob.

## Verification

1. `npx tsc --noEmit` clean; `npm run build` succeeds.
2. Headless Chrome (`--headless=new`, ANGLE/SwiftShader flags from research) screenshots of: title screen,
   `?demo=1` mid-game (virtual-time-budget). I visually inspect via Read; iterate until gorgeous.
3. In-page `window.onerror` capture div + `--dump-dom` grep for runtime errors.
4. Multi-agent review workflow (bugs / physics stability / perf / mobile-compat / game-feel lenses with
   screenshots), adversarial verification of findings, fix, re-run until dry (≤ 3 rounds).
5. Serve `dist/` locally + open in browser for the user; final screenshots delivered.

## Edge cases

Tab-hidden dt spike (accumulator clamp); audio autoplay policy (lazy AudioContext on first gesture + iOS
touchend unlock); localStorage unavailable (try/catch); rapid restart (full state reset incl. meshes/pools
disposal); same-frame multi-merge conflicts (mark-used set); WebGL context loss (listener + reload prompt);
resize/orientation change (visualViewport); DPR > 2 capped; reduced-motion preference respected.

## Risks

- Shader deformation normals: recompute via analytic perturbation, keep amplitudes modest.
- Glass transmission perf on mobile: ship fresnel fake by default.
- Headless WebGL flakiness: fall back to syntax/build checks + reviewer agents if screenshots impossible.
- Scope creep: max 2 original twist mechanics from the brief; everything else is polish.
