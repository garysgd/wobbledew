// Jelly deformation on a unit sphere. All "soft body" feel happens here,
// driven by real contact data from the 2D verlet sim.
uniform float uTime;
uniform float uSeed;
// xy = squash axis (unit), z = signed amount (+stretch along axis, -flatten)
uniform vec3 uSquash;
// xy = planar dir from center to contact, z = depth / radius, w = enabled
uniform vec4 uContacts[4];
// amp2, phase2, amp3, phase3 — damped ring harmonics excited on impact
uniform vec4 uWobble;

varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vLocal;

void main() {
  vec3 p = position;
  vec3 n = normal;

  // idle breathing — alive even at rest
  float breath = 1.0 + 0.014 * sin(uTime * 2.1 + uSeed * 9.7);
  p.xy *= breath;
  p.z *= 2.0 - breath;

  // squash & stretch along velocity axis
  float amt = uSquash.z;
  if (abs(amt) > 0.001) {
    vec2 d = uSquash.xy;
    vec2 perpAxis = vec2(-d.y, d.x);
    float along = dot(p.xy, d) * (1.0 + amt);
    float perp = dot(p.xy, perpAxis) / (1.0 + amt * 0.65);
    p.xy = d * along + perpAxis * perp;
    p.z /= (1.0 + amt * 0.30);
  }

  // wobble: damped mode-2 + mode-3 ring waves
  float ringW = length(p.xy);
  if (ringW > 0.001) {
    vec2 rdir = p.xy / ringW;
    float theta = atan(p.y, p.x);
    float off = uWobble.x * cos(2.0 * theta + uWobble.y)
              + uWobble.z * cos(3.0 * theta + uWobble.w);
    p.xy += rdir * off * ringW;
  }

  // contact flattening: clamp vertices behind each contact plane (cylindrical
  // in z, so the flat spot reads correctly from the front)
  for (int i = 0; i < 4; i++) {
    vec4 c = uContacts[i];
    if (c.w < 0.5) continue;
    float plane = 1.0 - c.z;
    float proj = dot(p.xy, c.xy);
    float excess = max(0.0, proj - plane);
    if (excess > 0.0) {
      p.xy -= c.xy * excess * 0.88;
      // flattened region's normal leans into the contact plane
      n = normalize(mix(n, vec3(-c.x, -c.y, n.z * 0.4), min(1.0, excess * 2.5)));
    }
  }

  // soften normals toward the deformed radial direction
  n = normalize(mix(n, normalize(p), 0.35));

  vLocal = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vViewPos = mv.xyz;
  vNormal = normalize(normalMatrix * n);
  gl_Position = projectionMatrix * mv;
}
