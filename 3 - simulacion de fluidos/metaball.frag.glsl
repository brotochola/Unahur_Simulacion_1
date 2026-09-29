precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uThreshold;
uniform vec4 uInputPixel;

const float kOutline = 2.1;
const float kThinLift = 0.14;
const float kDenseShade = 0.98;

float sampleA(vec2 uv) {
  return texture(uTexture, uv).a;
}

void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  float a = c.a;
  vec2 o = uInputPixel.zw * kOutline;
  vec2 d = o * 0.70710678;

  float aN = sampleA(vTextureCoord + vec2(0.0, -o.y));
  float aS = sampleA(vTextureCoord + vec2(0.0, o.y));
  float aE = sampleA(vTextureCoord + vec2(o.x, 0.0));
  float aW = sampleA(vTextureCoord + vec2(-o.x, 0.0));
  float aNE = sampleA(vTextureCoord + vec2(d.x, -d.y));
  float aNW = sampleA(vTextureCoord + vec2(-d.x, -d.y));
  float aSE = sampleA(vTextureCoord + vec2(d.x, d.y));
  float aSW = sampleA(vTextureCoord + vec2(-d.x, d.y));
  float ring = max(max(max(aN, aS), max(aE, aW)), max(max(aNE, aNW), max(aSE, aSW)));

  vec2 i = uInputPixel.zw * 1.25;
  vec2 id = i * 0.70710678;
  float core = min(a, sampleA(vTextureCoord + vec2(0.0, -i.y)));
  core = min(core, sampleA(vTextureCoord + vec2(0.0, i.y)));
  core = min(core, sampleA(vTextureCoord + vec2(i.x, 0.0)));
  core = min(core, sampleA(vTextureCoord + vec2(-i.x, 0.0)));
  core = min(core, sampleA(vTextureCoord + vec2(id.x, -id.y)));
  core = min(core, sampleA(vTextureCoord + vec2(-id.x, -id.y)));
  core = min(core, sampleA(vTextureCoord + vec2(id.x, id.y)));
  core = min(core, sampleA(vTextureCoord + vec2(-id.x, id.y)));

  float lo = uThreshold - 0.04;
  float hi = uThreshold + 0.02;
  float body = smoothstep(lo, hi, a);
  float stroke = clamp(smoothstep(lo, hi, ring) - body, 0.0, 1.0);
  float rim = body * (1.0 - smoothstep(lo, hi, core));

  vec3 base = a > 0.001 ? clamp(c.rgb / a, 0.0, 1.0) : vec3(0.0);
  float density = smoothstep(uThreshold, 1.0, a);
  vec3 shaded = mix(mix(base, vec3(1.0), kThinLift), base * kDenseShade, density);
  vec3 bodyCol = mix(shaded, mix(shaded, vec3(1.0), 0.35), rim);
  vec3 ink = base * 0.32;

  float alpha = max(body, stroke);
  vec3 rgb = mix(ink, bodyCol, body);
  finalColor = vec4(rgb * alpha, alpha);
}
