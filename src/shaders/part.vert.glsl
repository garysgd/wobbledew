// Face-part variant of the jelly deformer: the part's quad/mesh is placed in
// blob-unit space via uniforms, then deformed with the SAME squash/wobble/
// contact data as the body, so faces hug the jelly perfectly.
uniform float uTime;
uniform float uSeed;
uniform vec3 uSquash;
uniform vec4 uContacts[4];
uniform vec4 uWobble;
uniform vec3 uPartOffset;
uniform vec3 uPartScale;
uniform vec4 uUvRect;

varying vec2 vUv;

void main() {
  vec3 p = position * uPartScale + uPartOffset;

  float breath = 1.0 + 0.014 * sin(uTime * 2.1 + uSeed * 9.7);
  p.xy *= breath;
  p.z *= 2.0 - breath;

  float amt = uSquash.z;
  if (abs(amt) > 0.001) {
    vec2 d = uSquash.xy;
    vec2 perpAxis = vec2(-d.y, d.x);
    float along = dot(p.xy, d) * (1.0 + amt);
    float perp = dot(p.xy, perpAxis) / (1.0 + amt * 0.65);
    p.xy = d * along + perpAxis * perp;
    p.z /= (1.0 + amt * 0.30);
  }

  float ringW = length(p.xy);
  if (ringW > 0.001) {
    vec2 rdir = p.xy / ringW;
    float theta = atan(p.y, p.x);
    float off = uWobble.x * cos(2.0 * theta + uWobble.y)
              + uWobble.z * cos(3.0 * theta + uWobble.w);
    p.xy += rdir * off * ringW;
  }

  for (int i = 0; i < 4; i++) {
    vec4 c = uContacts[i];
    if (c.w < 0.5) continue;
    float plane = 1.0 - c.z;
    float proj = dot(p.xy, c.xy);
    float excess = max(0.0, proj - plane);
    if (excess > 0.0) p.xy -= c.xy * excess * 0.88;
  }

  vUv = uUvRect.xy + uv * uUvRect.zw;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
