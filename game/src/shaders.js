/* =========================================================================
   DEEP CAST — shaders.js
   All GLSL lives here. WebGL2 / GLSL ES 3.00.

   Reusable chunks are stitched together by `build()`, which also injects
   #define flags so one source can serve instanced and non-instanced draws.
   ========================================================================= */
(function (DC) {
  'use strict';

  var C = {};

  // ------------------------------------------------------------ common bits
  C.head = [
    'precision highp float;',
    'precision highp int;',
    '#define PI 3.14159265359',
    '#define TAU 6.28318530718'
  ].join('\n');

  // Analytic sky. Preetham-style single scattering; the wavelength-dependent
  // beta terms are precomputed on the CPU because they only change with the sun.
  C.sky = [
    'uniform vec3 uSunDir;',
    // Dominant light for surface shading: the sun by day, the moon by night.
    // Kept separate from uSunDir so the sky keeps scattering around the real sun.
    'uniform vec3 uLightDir;',
    'uniform vec3 uBetaR;',
    'uniform vec3 uBetaM;',
    'uniform float uSunE;',
    'uniform float uMieG;',
    'uniform vec3 uNightSky;',
    'uniform float uSkyDim;',
    '',
    'float rayleighPhase(float c) { return (3.0 / (16.0 * PI)) * (1.0 + c * c); }',
    'float hgPhase(float c, float g) {',
    '  float g2 = g * g;',
    '  float inv = 1.0 / pow(max(1.0 - 2.0 * g * c + g2, 1e-4), 1.5);',
    '  return (1.0 / (4.0 * PI)) * ((1.0 - g2) * inv);',
    '}',
    '',
    'vec3 skyRadiance(vec3 dir) {',
    '  const float RAY_ZENITH = 8.4e3;',
    '  const float MIE_ZENITH = 1.25e3;',
    '  vec3 up = vec3(0.0, 1.0, 0.0);',
    '  float cosZ = max(dir.y, -0.045);',
    '  float za = acos(clamp(cosZ, -1.0, 1.0));',
    '  float denom = cos(za) + 0.15 * pow(max(93.885 - degrees(za), 1e-3), -1.253);',
    '  denom = max(denom, 1e-3);',
    '  float sR = RAY_ZENITH / denom;',
    '  float sM = MIE_ZENITH / denom;',
    '  vec3 Fex = exp(-(uBetaR * sR + uBetaM * sM));',
    '  float cosTheta = dot(dir, uSunDir);',
    '  vec3 sum = uBetaR + uBetaM;',
    '  vec3 bR = uBetaR * rayleighPhase(cosTheta * 0.5 + 0.5);',
    '  vec3 bM = uBetaM * hgPhase(cosTheta, uMieG);',
    '  vec3 Lin = pow(uSunE * ((bR + bM) / sum) * (1.0 - Fex), vec3(1.5));',
    '  Lin *= mix(vec3(1.0),',
    '             pow(max(uSunE * ((bR + bM) / sum) * Fex, vec3(0.0)), vec3(0.5)),',
    '             clamp(pow(1.0 - max(dot(up, uSunDir), 0.0), 5.0), 0.0, 1.0));',
    '  vec3 L0 = vec3(0.1) * Fex;',
    '  vec3 col = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);',
    '  col *= uSkyDim;',
    '  return max(col + uNightSky * (0.35 + 0.65 * smoothstep(-0.25, 0.6, dir.y)), vec3(0.0));',
    '}'
  ].join('\n');

  // Distance + height fog whose colour comes from the sky in that direction,
  // which is what sells aerial perspective across a big lake.
  C.fog = [
    'uniform float uFogDensity;',
    'uniform float uFogHeight;',
    'vec3 applyFog(vec3 col, vec3 worldPos, vec3 camPos) {',
    '  vec3 d = worldPos - camPos;',
    '  float dist = length(d);',
    '  vec3 dir = d / max(dist, 1e-4);',
    '  float hf = exp(-max(camPos.y, -2.0) * uFogHeight);',
    '  float fall = abs(dir.y) < 1e-3 ? 1.0',
    '             : (1.0 - exp(-dist * dir.y * uFogHeight)) / (dist * dir.y * uFogHeight);',
    '  float amount = 1.0 - exp(-dist * uFogDensity * hf * max(fall, 0.0));',
    '  vec3 fogCol = skyRadiance(dir) * 0.80;',
    '  return mix(col, fogCol, clamp(amount, 0.0, 1.0));',
    '}'
  ].join('\n');

  C.gerstner = [
    'uniform vec4 uWaves[5];',
    'uniform float uWaveTime;',
    'uniform float uWaveScale;',
    'vec3 gerstner(vec2 p, out vec3 nrm) {',
    '  vec3 disp = vec3(0.0);',
    '  vec3 tang = vec3(1.0, 0.0, 0.0);',
    '  vec3 bino = vec3(0.0, 0.0, 1.0);',
    '  for (int i = 0; i < 5; i++) {',
    '    vec2 d = normalize(uWaves[i].xy);',
    '    float amp = uWaves[i].z * uWaveScale;',
    '    float len = uWaves[i].w;',
    '    float k = TAU / len;',
    '    float c = sqrt(9.81 / k);',
    '    float f = k * (dot(d, p) - c * uWaveTime * 0.42);',
    '    float Q = min(0.62 / (k * amp * 5.0 + 1e-4), 1.0);',
    '    float sf = sin(f), cf = cos(f);',
    '    disp.x += Q * amp * d.x * cf;',
    '    disp.z += Q * amp * d.y * cf;',
    '    disp.y += amp * sf;',
    '    float wa = k * amp;',
    '    tang.x += -Q * d.x * d.x * wa * sf;',
    '    tang.z += -Q * d.x * d.y * wa * sf;',
    '    tang.y += d.x * wa * cf;',
    '    bino.x += -Q * d.x * d.y * wa * sf;',
    '    bino.z += -Q * d.y * d.y * wa * sf;',
    '    bino.y += d.y * wa * cf;',
    '  }',
    '  nrm = normalize(cross(bino, tang));',
    '  return disp;',
    '}'
  ].join('\n');

  C.util = [
    'vec3 srgbToLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }',
    'float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    'float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }',
    'float hash31(vec3 p) {',
    '  p = fract(p * vec3(0.1031, 0.1030, 0.0973));',
    '  p += dot(p, p.yxz + 33.33);',
    '  return fract((p.x + p.y) * p.z);',
    '}'
  ].join('\n');

  C.noise = [
    'uniform sampler2D uNoise;',
    'float vnoise(vec2 p) { return texture(uNoise, p).r * 2.0 - 1.0; }',
    'float fbm(vec2 p) {',
    '  float s = 0.0, a = 0.5;',
    '  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; p += 7.3; a *= 0.5; }',
    '  return s / 0.9375;',
    '}',
    // Two octaves instead of four. Each octave is a dependent texture fetch,
    // and the terrain runs this per fragment across most of the screen: going
    // from four to two took ~18% off the whole frame. Detail this fine is
    // invisible on ground tint and caustics, so only the things that need the
    // extra octaves (clouds, water) still pay for them.
    'float fbmLo(vec2 p) {',
    '  float s = vnoise(p) * 0.5;',
    '  p = p * 2.03 + 7.3;',
    '  s += vnoise(p) * 0.25;',
    '  return s / 0.75;',
    '}'
  ].join('\n');

  var S = {};

  /* ======================================================================
     SKY
     ====================================================================== */
  S.skyVert = [
    'in vec2 aPos;',
    'uniform mat4 uInvViewProj;',
    'uniform vec3 uCamPos;',
    'out vec3 vRay;',
    'void main() {',
    '  gl_Position = vec4(aPos, 1.0, 1.0);',
    '  vec4 p = uInvViewProj * vec4(aPos, 1.0, 1.0);',
    '  vRay = p.xyz / p.w - uCamPos;',
    '}'
  ].join('\n');

  S.skyFrag = [
    C.sky, C.util, C.noise,
    'in vec3 vRay;',
    'uniform float uTime;',
    'uniform vec3 uMoonDir;',
    'uniform float uNightAmount;',
    'uniform float uCloudCover;',
    'uniform float uCloudDark;',
    'uniform vec2 uWind;',
    'out vec4 fragColor;',
    '',
    'float cloudFbm(vec2 p) {',
    '  float s = 0.0, a = 0.55;',
    '  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.07 + vec2(3.1, 1.7); a *= 0.52; }',
    '  return s;',
    '}',
    '',
    'void main() {',
    '  vec3 dir = normalize(vRay);',
    '  vec3 col = skyRadiance(dir);',
    '',
    '  // --- sun disc + bloomy halo',
    '  float cosT = dot(dir, uSunDir);',
    '  float disc = smoothstep(0.99955, 0.99975, cosT);',
    '  col += vec3(1.0, 0.94, 0.86) * disc * uSunE * 0.055;',
    '  col += vec3(1.0, 0.82, 0.62) * pow(max(cosT, 0.0), 900.0) * uSunE * 0.006;',
    '',
    '  // --- stars, only once the sky is actually dark',
    '  if (uNightAmount > 0.01 && dir.y > -0.03) {',
    '    vec3 sp = dir * 170.0;',
    '    vec3 id = floor(sp);',
    '    vec3 fp = fract(sp) - 0.5;',
    '    float r = hash31(id);',
    '    if (r > 0.972) {',
    '      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r * 6.0) + r * 40.0);',
    '      float s = exp(-dot(fp, fp) * 46.0) * (r - 0.972) / 0.028;',
    '      vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.88, 0.72), hash11(r * 91.0));',
    '      col += tint * s * tw * 1.5 * uNightAmount * smoothstep(-0.03, 0.22, dir.y);',
    '    }',
    '  }',
    '',
    '  // --- moon',
    '  float mc = dot(dir, uMoonDir);',
    '  if (mc > 0.9985) {',
    '    float d = sqrt(max(1.0 - mc * mc, 0.0)) / 0.055;',
    '    float edge = smoothstep(1.0, 0.94, d);',
    '    vec3 sd = normalize(uMoonDir + vec3(0.35, 0.12, 0.0));',
    '    vec2 mp = vec2(dot(dir, normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)))),',
    '                   dot(dir, normalize(cross(uMoonDir, normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)))))));',
    '    float craters = 0.82 + 0.18 * fbm(mp * 26.0);',
    '    col += vec3(0.98, 0.96, 0.90) * edge * craters * 2.2 * uNightAmount;',
    '  }',
    '  col += vec3(0.30, 0.36, 0.52) * pow(max(mc, 0.0), 340.0) * 0.35 * uNightAmount;',
    '',
    '  // --- cloud layer, projected onto a plane 900 units up',
    '  if (dir.y > 0.005 && uCloudCover > 0.001) {',
    '    // Project the view ray onto a cloud deck. The clamp stops the uv from',
    '    // exploding (and aliasing) as the ray flattens toward the horizon.',
    '    vec2 cp = dir.xz / max(dir.y, 0.055) * 0.075 + uWind * uTime * 0.004;',
    '    float horizon = smoothstep(0.004, 0.10, dir.y);',
    '    float n = cloudFbm(cp * 1.4) * 0.5 + 0.5;',
    '    float detail = cloudFbm(cp * 5.5 + 11.0) * 0.5 + 0.5;',
    '    n = mix(n, n * 0.72 + detail * 0.28, 0.7);',
    '    float cov = smoothstep(0.70 - uCloudCover * 0.62, 0.95 - uCloudCover * 0.55, n);',
    '    cov *= horizon;',
    '    // Cheap self-shadow: sample the field again, nudged toward the sun.',
    '    vec2 lp = cp + normalize(uSunDir.xz + vec2(1e-3)) * 0.09;',
    '    float ln = cloudFbm(lp * 1.4) * 0.5 + 0.5;',
    '    float lit = clamp((n - ln) * 3.0 + 0.55, 0.0, 1.0);',
    '    vec3 bright = mix(vec3(0.55, 0.58, 0.66), vec3(1.05, 1.0, 0.95), lit);',
    '    bright *= mix(vec3(0.16, 0.18, 0.24), vec3(1.0), clamp(uSunE * 0.9 + uNightAmount * 0.12, 0.0, 1.0));',
    '    bright *= mix(1.0, 0.45, uCloudDark);',
    '    float rim = pow(max(dot(dir, uSunDir), 0.0), 8.0);',
    '    bright += vec3(1.0, 0.75, 0.5) * rim * lit * uSunE * 0.25;',
    '    col = mix(col, bright, clamp(cov * 0.94, 0.0, 1.0));',
    '  }',
    '',
    '  fragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ======================================================================
     TERRAIN
     Layout: aPos(3) aNormal(3) aAO(1) aVar(1)
     ====================================================================== */
  S.terrainVert = [
    'in vec3 aPos;',
    'in vec3 aNormal;',
    'in float aAO;',
    'in float aVar;',
    'uniform mat4 uViewProj;',
    'out vec3 vPos;',
    'out vec3 vNormal;',
    'out float vAO;',
    'out float vVar;',
    'void main() {',
    '  vPos = aPos;',
    '  vNormal = aNormal;',
    '  vAO = aAO;',
    '  vVar = aVar;',
    '  gl_Position = uViewProj * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  S.terrainFrag = [
    C.sky, C.fog, C.util, C.noise,
    'in vec3 vPos;',
    'in vec3 vNormal;',
    'in float vAO;',
    'in float vVar;',
    'uniform vec3 uCamPos;',
    'uniform vec3 uSunColor;',
    'uniform vec3 uAmbSky;',
    'uniform vec3 uAmbGround;',
    'uniform vec4 uClipPlane;',
    'uniform float uTime;',
    'uniform float uWetness;',
    'out vec4 fragColor;',
    '',
    'void main() {',
    '  if (dot(vec4(vPos, 1.0), uClipPlane) < 0.0) discard;',
    '  vec3 N = normalize(vNormal);',
    '  float slope = clamp(N.y, 0.0, 1.0);',
    '  float h = vPos.y;',
    '',
    '  float grain = fbmLo(vPos.xz * 0.055) * 0.5 + 0.5;',
    '  float macro = fbmLo(vPos.xz * 0.0075) * 0.5 + 0.5;',
    '',
    '  vec3 sand   = mix(vec3(0.62, 0.55, 0.40), vec3(0.72, 0.66, 0.50), grain);',
    '  vec3 grass  = mix(vec3(0.16, 0.28, 0.11), vec3(0.28, 0.40, 0.16), grain);',
    '  grass = mix(grass, vec3(0.34, 0.42, 0.20), macro * 0.55);',
    '  vec3 rock   = mix(vec3(0.30, 0.29, 0.28), vec3(0.44, 0.43, 0.41), grain);',
    '  vec3 silt   = mix(vec3(0.22, 0.23, 0.17), vec3(0.32, 0.31, 0.22), grain);',
    '  vec3 weed   = vec3(0.10, 0.20, 0.10);',
    '  vec3 snow   = vec3(0.86, 0.90, 0.96);',
    '',
    '  vec3 base;',
    '  if (h < 0.0) {',
    '    // Lake bed: silt in the shallows going to dark weedy mud with depth.',
    '    float d = -h;',
    '    base = mix(sand, silt, smoothstep(0.0, 2.2, d));',
    '    base = mix(base, weed, smoothstep(1.5, 7.0, d) * (0.35 + 0.4 * macro));',
    '    base = mix(base, base * 0.55, smoothstep(8.0, 17.0, d));',
    '  } else {',
    '    base = mix(sand, grass, smoothstep(0.12, 0.95 + macro * 0.85, h));',
    '    base = mix(base, rock, smoothstep(0.86, 0.62, slope));',
    '    base = mix(base, rock, smoothstep(26.0, 44.0, h) * 0.8);',
    '    base = mix(base, snow, smoothstep(86.0, 124.0, h + macro * 14.0) * smoothstep(0.52, 0.86, slope));',
    '  }',
    '  base *= 0.86 + 0.28 * vVar;',
    '  // Damp band right at the waterline.',
    '  base *= mix(1.0, 0.72, smoothstep(1.4, 0.05, abs(h)) * uWetness);',
    '',
    '  // --- lighting',
    '  float ndl = max(dot(N, uLightDir), 0.0);',
    '  // Soft terminator so a low sun does not look like a hard cut.',
    '  ndl = mix(ndl, smoothstep(0.0, 0.35, dot(N, uLightDir)) * ndl, 0.5);',
    '  vec3 amb = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);',
    '  vec3 col = srgbToLinear(base) * (uSunColor * ndl + amb) * (0.35 + 0.65 * vAO);',
    '',
    '  // --- underwater: absorption + caustics',
    '  if (h < 0.0) {',
    '    float d = -h;',
    '    vec3 absorb = exp(-vec3(0.26, 0.10, 0.16) * d);',
    '    col *= absorb;',
    '    float c1 = fbmLo(vPos.xz * 0.085 + vec2(uTime * 0.035, uTime * 0.021));',
    '    float c2 = fbmLo(vPos.xz * 0.115 - vec2(uTime * 0.028, uTime * 0.04));',
    '    float caus = pow(clamp(1.0 - abs(c1 - c2) * 3.4, 0.0, 1.0), 5.0);',
    '    col += uSunColor * caus * 0.34 * exp(-d * 0.30) * max(uLightDir.y, 0.0) * slope;',
    '  }',
    '',
    '  col = applyFog(col, vPos, uCamPos);',
    '  fragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ======================================================================
     SOLID  (props, dock, rod, bobber; optional instancing + wind)
     Layout: aPos(3) aNormal(3) aColor(3) aFlex(1)
     Instances: iPosScale(4) iRotTint(4) -> rot in x, tint in yzw
     ====================================================================== */
  S.solidVert = [
    'in vec3 aPos;',
    'in vec3 aNormal;',
    'in vec3 aColor;',
    'in float aFlex;',
    '#ifdef INSTANCED',
    'in vec4 iPosScale;',
    'in vec4 iRotTint;',
    '#else',
    'uniform mat4 uModel;',
    'uniform mat3 uNormalMat;',
    'uniform vec3 uTint;',
    '#endif',
    'uniform mat4 uViewProj;',
    'uniform float uTime;',
    'uniform vec2 uWind;',
    'uniform float uWindStrength;',
    // Static deflection along aFlex — this is how the rod loads up under
    // a running fish. Zero for everything else.
    'uniform vec3 uBend;',
    'out vec3 vPos;',
    'out vec3 vNormal;',
    'out vec3 vColor;',
    'void main() {',
    '  vec3 p = aPos;',
    '  vec3 n = aNormal;',
    '#ifdef INSTANCED',
    '  float s = iPosScale.w;',
    '  float rot = iRotTint.x;',
    '  float cr = cos(rot), sr = sin(rot);',
    '  p = vec3(p.x * cr + p.z * sr, p.y, -p.x * sr + p.z * cr) * s + iPosScale.xyz;',
    '  n = vec3(n.x * cr + n.z * sr, n.y, -n.x * sr + n.z * cr);',
    '  vColor = aColor * iRotTint.yzw;',
    '#else',
    '  p = (uModel * vec4(p, 1.0)).xyz;',
    '  n = normalize(uNormalMat * n);',
    '  vColor = aColor * uTint;',
    '#endif',
    '  if (aFlex > 0.001) {',
    '    float ph = p.x * 0.16 + p.z * 0.13;',
    '    float sway = sin(uTime * 1.35 + ph) * 0.62 + sin(uTime * 2.7 + ph * 1.9) * 0.28;',
    '    p.xz += uWind * sway * aFlex * uWindStrength;',
    '    p.y -= abs(sway) * aFlex * uWindStrength * 0.22;',
    '  }',
    '  p += uBend * aFlex;',
    '  vPos = p;',
    '  vNormal = n;',
    '  gl_Position = uViewProj * vec4(p, 1.0);',
    '}'
  ].join('\n');

  S.solidFrag = [
    C.sky, C.fog, C.util,
    'in vec3 vPos;',
    'in vec3 vNormal;',
    'in vec3 vColor;',
    'uniform vec3 uCamPos;',
    'uniform vec3 uSunColor;',
    'uniform vec3 uAmbSky;',
    'uniform vec3 uAmbGround;',
    'uniform vec4 uClipPlane;',
    'uniform float uSpecular;',
    'uniform float uEmissive;',
    'uniform float uNoFog;',
    'out vec4 fragColor;',
    'void main() {',
    '  if (dot(vec4(vPos, 1.0), uClipPlane) < 0.0) discard;',
    '  vec3 N = normalize(vNormal);',
    '  vec3 V = normalize(uCamPos - vPos);',
    '  if (!gl_FrontFacing) N = -N;',
    '  float ndl = max(dot(N, uLightDir), 0.0);',
    '  vec3 amb = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);',
    '  vec3 base = srgbToLinear(vColor);',
    '  vec3 col = base * (uSunColor * ndl + amb);',
    '  vec3 H = normalize(uLightDir + V);',
    '  col += uSunColor * pow(max(dot(N, H), 0.0), 42.0) * uSpecular * ndl;',
    '  col += base * uEmissive;',
    '  // Rim term keeps silhouettes from dissolving into the fog.',
    '  col += amb * pow(1.0 - max(dot(N, V), 0.0), 3.5) * 0.35;',
    '  if (uNoFog < 0.5) col = applyFog(col, vPos, uCamPos);',
    '  if (vPos.y < 0.0) col *= exp(-vec3(0.26, 0.10, 0.16) * (-vPos.y));',
    '  fragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ======================================================================
     FISH  (instanced, with a travelling-wave body bend)
     Instances: iPosSize(4) iRot(4)=yaw,pitch,phase,bend
                iDorsal(3) iBelly(3) iFin(4)=rgb,glow
     ====================================================================== */
  S.fishVert = [
    'in vec3 aPos;',
    'in vec3 aNormal;',
    'in vec3 aColor;',
    'in float aFlex;',
    'in vec4 iPosSize;',
    'in vec4 iRot;',
    'in vec3 iDorsal;',
    'in vec3 iBelly;',
    'in vec4 iFin;',
    'in vec3 iShape;',
    'uniform mat4 uViewProj;',
    'uniform float uTime;',
    'out vec3 vPos;',
    'out vec3 vNormal;',
    'out vec3 vColor;',
    'out float vGlow;',
    'void main() {',
    '  vec3 p = aPos * iShape;',
    '  vec3 n = normalize(aNormal / max(iShape, vec3(1e-3)));',
    '',
    '  // Travelling sine down the body; amplitude ramps toward the tail.',
    '  float wave = sin(p.x * 6.2 - uTime * iRot.w * 9.0 + iRot.z);',
    '  float amp = aFlex * iRot.w * 0.075;',
    '  p.z += wave * amp;',
    '  // Rotate the normal by the local slope of that bend.',
    '  float slope = cos(p.x * 6.2 - uTime * iRot.w * 9.0 + iRot.z) * 6.2 * amp;',
    '  n = normalize(vec3(n.x - n.z * slope, n.y, n.z + n.x * slope));',
    '',
    '  float s = iPosSize.w;',
    '  p *= s;',
    '  float pitch = iRot.y;',
    '  float cp = cos(pitch), sp = sin(pitch);',
    '  p = vec3(p.x * cp - p.y * sp, p.x * sp + p.y * cp, p.z);',
    '  n = vec3(n.x * cp - n.y * sp, n.x * sp + n.y * cp, n.z);',
    '  float yaw = iRot.x;',
    '  float cy = cos(yaw), sy = sin(yaw);',
    '  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);',
    '  n = vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy);',
    '  p += iPosSize.xyz;',
    '',
    '  vec3 body = mix(iBelly, iDorsal, smoothstep(0.18, 0.86, aColor.r));',
    '  vColor = mix(body, iFin.rgb, step(0.5, aColor.g));',
    '  vGlow = iFin.w;',
    '  vPos = p;',
    '  vNormal = n;',
    '  gl_Position = uViewProj * vec4(p, 1.0);',
    '}'
  ].join('\n');

  S.fishFrag = [
    C.sky, C.fog, C.util, C.noise,
    'in vec3 vPos;',
    'in vec3 vNormal;',
    'in vec3 vColor;',
    'in float vGlow;',
    'uniform vec3 uCamPos;',
    'uniform vec3 uSunColor;',
    'uniform vec3 uAmbSky;',
    'uniform vec3 uAmbGround;',
    'uniform vec4 uClipPlane;',
    'uniform float uTime;',
    'out vec4 fragColor;',
    'void main() {',
    '  if (dot(vec4(vPos, 1.0), uClipPlane) < 0.0) discard;',
    '  vec3 N = normalize(vNormal);',
    '  if (!gl_FrontFacing) N = -N;',
    '  vec3 V = normalize(uCamPos - vPos);',
    '  float ndl = max(dot(N, uLightDir), 0.0);',
    '  vec3 amb = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);',
    '  vec3 base = srgbToLinear(vColor);',
    '  vec3 col = base * (uSunColor * ndl * 0.85 + amb);',
    '',
    '  // Wet, iridescent flanks.',
    '  vec3 H = normalize(uLightDir + V);',
    '  float spec = pow(max(dot(N, H), 0.0), 90.0);',
    '  col += uSunColor * spec * 0.9;',
    '  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);',
    '  col += mix(vec3(0.42, 0.62, 0.78), vec3(0.95, 0.86, 0.66), spec) * fres * 0.62;',
    '  // Flank flash: a turning fish catches the light. This is the single',
    '  // biggest thing that makes a shoal readable through the surface.',
    '  float flank = pow(max(dot(N, normalize(cross(uLightDir, vec3(0.0, 1.0, 0.0)))), 0.0), 6.0);',
    '  col += uSunColor * flank * 0.22;',
    '',
    '  if (vPos.y < 0.0) {',
    '    float d = -vPos.y;',
    '    // The water shader already absorbs along the camera path, so this is',
    '    // only the downward light path. Kept deliberately weak: physically',
    '    // honest values make the fish you are trying to catch invisible.',
    '    col *= exp(-vec3(0.26, 0.10, 0.16) * d * 0.42);',
    '    float c1 = fbmLo(vPos.xz * 0.09 + vec2(uTime * 0.035, uTime * 0.021));',
    '    float c2 = fbmLo(vPos.xz * 0.12 - vec2(uTime * 0.028, uTime * 0.04));',
    '    float caus = pow(clamp(1.0 - abs(c1 - c2) * 3.4, 0.0, 1.0), 5.0);',
    '    col += uSunColor * caus * 0.30 * exp(-d * 0.30) * max(uLightDir.y, 0.0) * max(N.y, 0.0);',
    '  }',
    '  col += base * vGlow * (0.55 + 0.45 * sin(uTime * 2.0 + vPos.x));',
    '  col = applyFog(col, vPos, uCamPos);',
    '  fragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ======================================================================
     WATER
     ====================================================================== */
  S.waterVert = [
    C.gerstner,
    'in vec2 aPos;',              // polar grid offset in XZ
    'uniform mat4 uViewProj;',
    'uniform vec2 uCenter;',
    'out vec3 vPos;',
    'out vec3 vNormal;',
    'out float vDist;',
    'void main() {',
    '  vec2 xz = aPos + uCenter;',
    '  vec3 n;',
    '  vec3 d = gerstner(xz, n);',
    '  vec3 p = vec3(xz.x + d.x, d.y, xz.y + d.z);',
    '  vPos = p;',
    '  vNormal = n;',
    '  vDist = length(aPos);',
    '  gl_Position = uViewProj * vec4(p, 1.0);',
    '}'
  ].join('\n');

  S.waterFrag = [
    C.sky, C.util, C.noise,
    'in vec3 vPos;',
    'in vec3 vNormal;',
    'in float vDist;',
    'uniform vec3 uCamPos;',
    'uniform vec3 uSunColor;',
    'uniform vec3 uAmbSky;',
    'uniform sampler2D uReflect;',
    'uniform sampler2D uRefract;',
    'uniform sampler2D uRefractDepth;',
    'uniform sampler2D uWaterNormal;',
    'uniform sampler2D uHeight;',
    'uniform vec2 uScreen;',
    'uniform float uTime;',
    'uniform float uNear;',
    'uniform float uFar;',
    'uniform float uTerrainExtent;',
    'uniform float uFogDensity;',
    'uniform float uFogHeight;',
    'uniform vec3 uShallowTint;',
    'uniform vec3 uDeepTint;',
    'uniform float uRipple;',
    'uniform float uWaveScale;',
    'out vec4 fragColor;',
    '',
    'float linDepth(float z) {',
    '  float ndc = z * 2.0 - 1.0;',
    '  return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));',
    '}',
    'vec3 sampleNormal(vec2 uv, float scale, vec2 drift) {',
    '  vec3 n = texture(uWaterNormal, uv * scale + drift).xyz * 2.0 - 1.0;',
    '  return normalize(vec3(n.x, n.y * 1.6, n.z));',
    '}',
    '',
    'void main() {',
    '  float terr = texture(uHeight, vPos.xz / (2.0 * uTerrainExtent) + 0.5).r;',
    '  if (terr > -0.015) discard;',
    '',
    '  vec3 V = normalize(uCamPos - vPos);',
    '  float dist = length(uCamPos - vPos);',
    '',
    '  // --- detail normals: two layers drifting at different rates',
    '  float detailFade = clamp(1.0 - dist / 260.0, 0.15, 1.0);',
    '  vec3 n1 = sampleNormal(vPos.xz, 0.075, vec2(uTime * 0.010, uTime * 0.014));',
    '  vec3 n2 = sampleNormal(vPos.xz, 0.021, vec2(-uTime * 0.006, uTime * 0.004));',
    '  vec3 n3 = sampleNormal(vPos.xz, 0.24, vec2(uTime * 0.03, -uTime * 0.021));',
    '  vec3 detail = normalize(n1 * 0.5 + n2 * 0.85 + n3 * 0.28 * detailFade);',
    '  vec3 N = normalize(vNormal + vec3(detail.x, 0.0, detail.z) * 0.55 * detailFade);',
    '',
    '  // --- depth of water under this fragment (along the view ray)',
    '  vec2 uv = gl_FragCoord.xy / uScreen;',
    '  float surfZ = linDepth(gl_FragCoord.z);',
    '  vec2 offs = N.xz * clamp(0.022 / max(dist * 0.06, 0.5), 0.0, 0.028);',
    '  float botZraw = linDepth(texture(uRefractDepth, uv + offs).r);',
    '  if (botZraw < surfZ) { offs = vec2(0.0); botZraw = linDepth(texture(uRefractDepth, uv).r); }',
    '  float travel = max(botZraw - surfZ, 0.0) * (dist / max(surfZ, 1e-3));',
    '  float vertDepth = max(-terr, 0.0);',
    '',
    '  vec3 refr = texture(uRefract, uv + offs).rgb;',
    '  vec3 absorb = exp(-vec3(0.30, 0.11, 0.17) * travel);',
    '  vec3 water = refr * absorb;',
    '  // Scattered light in the water column.',
    '  water += uShallowTint * (uSunColor * 0.30 + uAmbSky * 0.75) * (1.0 - absorb) * 0.85;',
    '  water = mix(water, uDeepTint * (uAmbSky + uSunColor * 0.35), clamp(travel / 22.0, 0.0, 0.92));',
    '',
    '  // --- planar reflection. The mirrored render places each reflected',
    '  //     point at this fragment own screen position, so the lookup is',
    '  //     simply the screen UV, nudged by the surface normal.',
    '  vec2 ruv = uv + N.xz * vec2(0.016, -0.016) * clamp(1.2 / max(dist * 0.05, 0.6), 0.0, 1.0);',
    '  vec3 R = reflect(-V, N);',
    '  R.y = abs(R.y);',
    '  vec3 skyRef = skyRadiance(R);',
    '  vec3 refl = skyRef;',
    '  if (ruv.x > 0.002 && ruv.x < 0.998 && ruv.y > 0.002 && ruv.y < 0.998) {',
    '    vec4 rt = texture(uReflect, ruv);',
    '    refl = mix(skyRef, rt.rgb / max(rt.a, 0.001), clamp(rt.a, 0.0, 1.0));',
    '  }',
    '',
    '  float fres = 0.02 + 0.98 * pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0, 1.0), 5.0);',
    '  fres *= 0.94;',
    '  vec3 col = mix(water, refl, fres);',
    '',
    '  // --- sun specular: a tight core plus wide glitter from the detail normals',
    '  vec3 H = normalize(uLightDir + V);',
    '  float core = pow(max(dot(N, H), 0.0), 900.0);',
    '  vec3 gn = normalize(vNormal + vec3(detail.x, 0.0, detail.z) * 1.5);',
    '  float glitter = pow(max(dot(gn, H), 0.0), 180.0);',
    '  col += uSunColor * (core * 2.6 + glitter * 0.55 * detailFade);',
    '',
    '  // --- foam: shoreline wash + wave-crest whitecaps + cast ripples',
    '  float shoreN = texture(uWaterNormal, vPos.xz * 0.11 + vec2(uTime * 0.02, -uTime * 0.013)).a;',
    '  float lap = 0.62 + 0.38 * sin(uTime * 1.5 + vPos.x * 0.7 + vPos.z * 0.5);',
    '  float shore = smoothstep(1.35, 0.0, travel) * smoothstep(1.6, 0.10, vertDepth);',
    '  float foam = shore * smoothstep(0.22, 0.66, shoreN * lap + 0.26);',
    '  float amp = 0.213 * uWaveScale;',
    '  float crest = smoothstep(amp * 0.70, amp * 1.05, vPos.y) * smoothstep(0.40, 0.85, shoreN);',
    '  crest *= smoothstep(1.05, 2.1, uWaveScale);',
    '  foam = clamp(foam + crest * 0.6, 0.0, 1.0) * clamp(1.0 - dist / 320.0, 0.0, 1.0);',
    '  col = mix(col, (uSunColor * 0.55 + uAmbSky) * 1.05, foam * 0.85);',
    '',
    '  // --- fog',
    '  vec3 dir = normalize(vPos - uCamPos);',
    '  float amount = 1.0 - exp(-dist * uFogDensity * exp(-max(uCamPos.y, -2.0) * uFogHeight));',
    '  col = mix(col, skyRadiance(dir) * 0.80, clamp(amount, 0.0, 1.0));',
    '',
    '  fragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ======================================================================
     RIPPLE DECALS  (rings that sit on the animated surface)
     ====================================================================== */
  S.rippleVert = [
    C.gerstner,
    'in vec3 aPos;',
    'in vec3 aColor;',
    'in float aFlex;',
    'in vec4 iPosSize;',   // xyz centre, w radius
    'in vec4 iParam;',     // x alpha, y width, z seed, w unused
    'uniform mat4 uViewProj;',
    'out float vAlpha;',
    'out float vEdge;',
    'void main() {',
    '  vec2 xz = aPos.xz * iPosSize.w + iPosSize.xz;',
    '  vec3 n;',
    '  vec3 d = gerstner(xz, n);',
    '  float t = aFlex;',
    '  float r = mix(1.0 - iParam.y, 1.0, t);',
    '  xz = aPos.xz * iPosSize.w * r + iPosSize.xz;',
    '  vec3 p = vec3(xz.x + d.x, d.y + 0.012, xz.y + d.z);',
    '  vAlpha = iParam.x;',
    '  vEdge = t;',
    '  gl_Position = uViewProj * vec4(p, 1.0);',
    '}'
  ].join('\n');

  S.rippleFrag = [
    'in float vAlpha;',
    'in float vEdge;',
    'uniform vec3 uSunColor;',
    'uniform vec3 uAmbSky;',
    'out vec4 fragColor;',
    'void main() {',
    '  float a = sin(vEdge * PI);',
    '  a = pow(clamp(a, 0.0, 1.0), 1.4) * vAlpha;',
    '  fragColor = vec4((uSunColor * 0.6 + uAmbSky) * 1.2, a);',
    '}'
  ].join('\n');

  /* ======================================================================
     PARTICLES  (billboarded splash droplets and spray)
     ====================================================================== */
  S.particleVert = [
    'in vec2 aCorner;',
    'in vec4 iPosSize;',
    'in vec4 iColor;',
    'uniform mat4 uViewProj;',
    'uniform vec3 uRight;',
    'uniform vec3 uUp;',
    'out vec2 vUV;',
    'out vec4 vColor;',
    'void main() {',
    '  vec3 p = iPosSize.xyz + (uRight * aCorner.x + uUp * aCorner.y) * iPosSize.w;',
    '  vUV = aCorner;',
    '  vColor = iColor;',
    '  gl_Position = uViewProj * vec4(p, 1.0);',
    '}'
  ].join('\n');

  S.particleFrag = [
    'in vec2 vUV;',
    'in vec4 vColor;',
    'out vec4 fragColor;',
    'void main() {',
    '  float d = dot(vUV, vUV) * 4.0;',
    '  float a = exp(-d * 2.2);',
    '  if (a < 0.004) discard;',
    '  fragColor = vec4(vColor.rgb, vColor.a * a);',
    '}'
  ].join('\n');

  /* ======================================================================
     LINE  (fishing line, drawn as GL_LINE_STRIP)
     ====================================================================== */
  S.lineVert = [
    'in vec3 aPos;',
    'in float aT;',
    'uniform mat4 uViewProj;',
    'out float vT;',
    'void main() {',
    '  vT = aT;',
    '  gl_Position = uViewProj * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  S.lineFrag = [
    'in float vT;',
    'uniform vec4 uColor;',
    'out vec4 fragColor;',
    'void main() { fragColor = vec4(uColor.rgb, uColor.a); }'
  ].join('\n');

  /* ======================================================================
     POST  (bright pass, blur, composite)
     ====================================================================== */
  S.fsVert = [
    'in vec2 aPos;',
    'out vec2 vUV;',
    'void main() {',
    '  vUV = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  S.brightFrag = [
    C.util,
    'in vec2 vUV;',
    'uniform sampler2D uTex;',
    'uniform float uThreshold;',
    'uniform float uExposure;',
    'out vec4 fragColor;',
    'void main() {',
    '  vec3 c = texture(uTex, vUV).rgb * uExposure;',
    '  float l = luma(c);',
    '  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);',
    '  fragColor = vec4(c * k, 1.0);',
    '}'
  ].join('\n');

  S.blurFrag = [
    'in vec2 vUV;',
    'uniform sampler2D uTex;',
    'uniform vec2 uDir;',
    'out vec4 fragColor;',
    'void main() {',
    '  vec3 s = texture(uTex, vUV).rgb * 0.227027;',
    '  s += texture(uTex, vUV + uDir * 1.3846).rgb * 0.316216;',
    '  s += texture(uTex, vUV - uDir * 1.3846).rgb * 0.316216;',
    '  s += texture(uTex, vUV + uDir * 3.2308).rgb * 0.070270;',
    '  s += texture(uTex, vUV - uDir * 3.2308).rgb * 0.070270;',
    '  fragColor = vec4(s, 1.0);',
    '}'
  ].join('\n');

  S.compositeFrag = [
    C.util,
    'in vec2 vUV;',
    'uniform sampler2D uTex;',
    'uniform sampler2D uBloom;',
    'uniform float uExposure;',
    'uniform float uBloomAmount;',
    'uniform float uVignette;',
    'uniform float uTime;',
    'uniform float uGrain;',
    'uniform float uUnderwater;',
    'uniform vec3 uUnderTint;',
    'uniform float uFlash;',
    'uniform vec3 uFlashColor;',
    'uniform float uSaturation;',
    'out vec4 fragColor;',
    '',
    'vec3 aces(vec3 x) {',
    '  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;',
    '  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = vUV;',
    '  // Underwater: gentle lens wobble.',
    '  if (uUnderwater > 0.001) {',
    '    uv += vec2(sin(uv.y * 22.0 + uTime * 1.7), cos(uv.x * 18.0 + uTime * 1.3)) * 0.0022 * uUnderwater;',
    '  }',
    '  vec3 c = texture(uTex, uv).rgb;',
    '  c += texture(uBloom, uv).rgb * uBloomAmount;',
    '  c *= uExposure;',
    '  c = mix(c, c * uUnderTint, uUnderwater);',
    '  c += uFlashColor * uFlash;',
    '  c = aces(c);',
    '  float l = luma(c);',
    '  c = clamp(mix(vec3(l), c, uSaturation), 0.0, 1.0);',
    '  c = pow(c, vec3(1.0 / 2.2));',
    '  vec2 q = vUV - 0.5;',
    '  c *= 1.0 - dot(q, q) * uVignette;',
    '  float g = fract(sin(dot(vUV * vec2(1.0, 1.3) + uTime * 0.37, vec2(12.9898, 78.233))) * 43758.5453);',
    '  c += (g - 0.5) * uGrain;',
    '  fragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  // ------------------------------------------------------------------ build
  function build(src, defines) {
    var d = '';
    if (defines) {
      for (var k in defines) {
        if (defines[k]) d += '#define ' + k + ' ' + (defines[k] === true ? '1' : defines[k]) + '\n';
      }
    }
    return '#version 300 es\n' + C.head + '\n' + d + src + '\n';
  }

  DC.Shaders = { S: S, C: C, build: build };
})(DC);
