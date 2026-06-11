// Matcap jelly shading: grayscale matcap drives a deep→light color ramp,
// plus fresnel rim, hot specular pop, and a fake bottom-light SSS glow.
uniform sampler2D uMatcap;
uniform vec3 uColorDeep;
uniform vec3 uColorLight;
uniform vec3 uRimColor;
uniform float uFlash; // 0..1 white flash on merge birth
uniform float uTime;
uniform float uAurora; // 1 = legendary Borealis sheen

varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vLocal;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(-vViewPos);

  vec2 muv = N.xy * 0.495 + 0.5;
  float m = texture2D(uMatcap, muv).r;

  // remap matcap so mid-tones sit in the saturated body color
  vec3 col = mix(uColorDeep, uColorLight, smoothstep(0.18, 0.92, m));

  // hot specular pop from the matcap's bright spot
  float spec = smoothstep(0.88, 0.985, m);
  col += vec3(1.0) * spec * 0.5;

  // fresnel rim — the gummy translucent edge
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  col += uRimColor * fres * 0.38;

  // fake subsurface: light leaks through the belly
  float sss = pow(max(0.0, -N.y * 0.5 + 0.5), 2.0);
  col += uColorLight * sss * 0.12;

  // subtle vertical ramp keeps tops airy, bellies dense
  col *= mix(0.93, 1.07, smoothstep(-1.0, 1.0, vLocal.y));

  // legendary aurora sheen: a slow hue-drifting band rolling over the body
  if (uAurora > 0.01) {
    float band = smoothstep(0.0, 1.0, sin(vLocal.y * 2.6 - vLocal.x * 0.8 + uTime * 1.1) * 0.5 + 0.5);
    float huePhase = sin(uTime * 0.6 + vLocal.x * 1.7) * 0.5 + 0.5;
    vec3 auroraCol = mix(vec3(0.56, 0.98, 0.88), vec3(0.65, 0.58, 1.0), huePhase);
    col += auroraCol * band * 0.38 * uAurora;
  }

  // merge-birth flash
  col = mix(col, vec3(1.0, 0.99, 0.96), uFlash);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
