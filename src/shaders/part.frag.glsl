uniform sampler2D uTex;
uniform vec3 uTint;
uniform float uAlpha;

varying vec2 vUv;

void main() {
  vec4 t = texture2D(uTex, vUv);
  if (t.a < 0.02) discard;
  gl_FragColor = vec4(t.rgb * uTint, t.a * uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
