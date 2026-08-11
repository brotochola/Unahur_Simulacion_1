/**
 * gpu-physics.js — Física en WebGL2 (fragment ping-pong).
 * Orden substep: Fick (outflows→gather) → gravedad approx → flowfield (+ avg).
 *
 * State RGBA32F: R=mass G=type B=flowX A=flowY
 * Transfer RGBA32F: R=accX G=accY B=had A=0
 * Outflow A/B: o0..o3 / o4..o7 escalados
 *
 * Chunks: mismo culling que CPU (processChunkList + wake/hysteresis).
 * ponytail: gravedad ≠ falling-sand bit-exact (sin barrido bottom-up);
 * upgrade: WebGPU atomics.
 */
'use strict';

let gpuPhysReady = false;
let gpuProgFickOut = null;
let gpuProgFickGather = null;
let gpuProgGrav = null;
let gpuProgFlow = null;
let gpuProgAvg = null;
let gpuProgWake = null;
let gpuTransferTex = null;
let gpuOutflowA = null;
let gpuOutflowB = null;
let gpuBlitReadFbo = null;
let gpuBlitDrawFbo = null;
let gpuWakeTex = null;
let gpuWakeFbo = null;
let gpuWakeScratch = null;
let gpuWakeW = 0;
let gpuWakeH = 0;

const VS_SIM = `#version 300 es
in vec2 aPos;
void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Shared helpers prepended to sim fragment shaders */
const FS_COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uState;
uniform int uGridSize;
uniform float uRest;
uniform float uTFloor;

ivec2 dirOf(int i) {
    if (i == 0) return ivec2(0, 1);
    if (i == 1) return ivec2(1, 1);
    if (i == 2) return ivec2(1, 0);
    if (i == 3) return ivec2(1, -1);
    if (i == 4) return ivec2(0, -1);
    if (i == 5) return ivec2(-1, -1);
    if (i == 6) return ivec2(-1, 0);
    return ivec2(-1, 1);
}

float invDistOf(int i) {
    return (i == 1 || i == 3 || i == 5 || i == 7) ? 0.70710678118 : 1.0;
}

bool isSolid(float typ) { return typ > 0.5 && typ < 1.5; }
bool isWater(float typ) { return typ >= 1.5; }

bool inInner(ivec2 p, int gs) {
    return p.x >= 1 && p.y >= 1 && p.x <= gs - 2 && p.y <= gs - 2;
}
`;

const FS_FICK_OUT = FS_COMMON + `
uniform float uD;
uniform float uFlowInf;

layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;

void main() {
    int gs = uGridSize;
    ivec2 p = ivec2(gl_FragCoord.xy);
    outA = vec4(0.0);
    outB = vec4(0.0);

    if (p.x <= 0 || p.y <= 0 || p.x >= gs - 1 || p.y >= gs - 1) return;

    vec4 c = texelFetch(uState, p, 0);
    if (!isWater(c.g)) return;
    float mass = c.r;
    if (mass < uRest) return;
    float Ci = mass - uRest;
    if (Ci <= uTFloor && uFlowInf <= 0.0) return;
    vec2 f = vec2(c.b, c.a);

    float o0 = 0.0, o1 = 0.0, o2 = 0.0, o3 = 0.0;
    float o4 = 0.0, o5 = 0.0, o6 = 0.0, o7 = 0.0;
    float sumOut = 0.0;

    for (int i = 0; i < 8; i++) {
        ivec2 np = p + dirOf(i);
        if (!inInner(np, gs)) continue;
        vec4 n = texelFetch(uState, np, 0);
        if (isSolid(n.g)) continue;
        float massN = isWater(n.g) ? n.r : 0.0;
        float ganas = Ci - massN;
        float j = 0.0;
        if (ganas > 0.0) j = uD * ganas * invDistOf(i);
        vec2 nd = vec2(float(dirOf(i).x), float(dirOf(i).y)) * invDistOf(i);
        j += max(0.0, dot(f, nd) * uFlowInf);
        if (j > uTFloor) {
            if (i == 0) o0 = j;
            else if (i == 1) o1 = j;
            else if (i == 2) o2 = j;
            else if (i == 3) o3 = j;
            else if (i == 4) o4 = j;
            else if (i == 5) o5 = j;
            else if (i == 6) o6 = j;
            else o7 = j;
            sumOut += j;
        }
    }
    if (sumOut <= 0.0) return;
    float exceso = mass - uRest;
    float scale = sumOut > exceso ? exceso / sumOut : 1.0;
    outA = vec4(o0, o1, o2, o3) * scale;
    outB = vec4(o4, o5, o6, o7) * scale;
}
`;

const FS_FICK_GATHER = FS_COMMON + `
uniform sampler2D uOutA;
uniform sampler2D uOutB;

layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outTransfer;

float outComp(vec4 a, vec4 b, int dir) {
    if (dir == 0) return a.r;
    if (dir == 1) return a.g;
    if (dir == 2) return a.b;
    if (dir == 3) return a.a;
    if (dir == 4) return b.r;
    if (dir == 5) return b.g;
    if (dir == 6) return b.b;
    return b.a;
}

void main() {
    int gs = uGridSize;
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 c = texelFetch(uState, p, 0);

    if (p.x <= 0 || p.y <= 0 || p.x >= gs - 1 || p.y >= gs - 1 || isSolid(c.g)) {
        outState = c;
        outTransfer = vec4(0.0);
        return;
    }

    vec4 oa = texelFetch(uOutA, p, 0);
    vec4 ob = texelFetch(uOutB, p, 0);
    float o0 = oa.r, o1 = oa.g, o2 = oa.b, o3 = oa.a;
    float o4 = ob.r, o5 = ob.g, o6 = ob.b, o7 = ob.a;
    float sumOut = o0 + o1 + o2 + o3 + o4 + o5 + o6 + o7;

    float accX = 0.0, accY = 0.0, had = 0.0;
    if (o0 > uTFloor) { accY += 1.0 * o0; had = 1.0; }
    if (o1 > uTFloor) { accX += 0.70710678118 * o1; accY += 0.70710678118 * o1; had = 1.0; }
    if (o2 > uTFloor) { accX += 1.0 * o2; had = 1.0; }
    if (o3 > uTFloor) { accX += 0.70710678118 * o3; accY += -0.70710678118 * o3; had = 1.0; }
    if (o4 > uTFloor) { accY += -1.0 * o4; had = 1.0; }
    if (o5 > uTFloor) { accX += -0.70710678118 * o5; accY += -0.70710678118 * o5; had = 1.0; }
    if (o6 > uTFloor) { accX += -1.0 * o6; had = 1.0; }
    if (o7 > uTFloor) { accX += -0.70710678118 * o7; accY += 0.70710678118 * o7; had = 1.0; }

    float sumIn = 0.0;
    for (int i = 0; i < 8; i++) {
        ivec2 np = p + dirOf(i);
        if (!inInner(np, gs)) continue;
        int opp = (i + 4) % 8;
        vec4 na = texelFetch(uOutA, np, 0);
        vec4 nb = texelFetch(uOutB, np, 0);
        sumIn += outComp(na, nb, opp);
    }

    float newMass = max(0.0, c.r - sumOut + sumIn);
    float newType = newMass > uTFloor ? 2.0 : 0.0;
    outState = vec4(newMass, newType, c.b, c.a);
    outTransfer = vec4(accX, accY, had, 0.0);
}
`;

const FS_GRAV = FS_COMMON + `
uniform float uGrav;
uniform int uStep;
uniform sampler2D uTransferIn;

layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outTransfer;

float hash21(ivec2 p, int step) {
    vec2 v = vec2(float(p.x), float(p.y)) + float(step) * 17.13;
    return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453);
}

bool canEnter(ivec2 np, int gs) {
    if (!inInner(np, gs)) return false;
    vec4 n = texelFetch(uState, np, 0);
    return !isSolid(n.g);
}

int chooseDir(ivec2 p, int gs, float mass) {
    if (mass <= uTFloor) return -1;
    bool flip = hash21(p, uStep) > 0.5;
    if (canEnter(p + ivec2(0, 1), gs)) return 0;
    if (flip) {
        if (canEnter(p + ivec2(1, 1), gs)) return 1;
        if (canEnter(p + ivec2(-1, 1), gs)) return 7;
        if (canEnter(p + ivec2(1, 0), gs)) return 2;
        if (canEnter(p + ivec2(-1, 0), gs)) return 6;
    } else {
        if (canEnter(p + ivec2(-1, 1), gs)) return 7;
        if (canEnter(p + ivec2(1, 1), gs)) return 1;
        if (canEnter(p + ivec2(-1, 0), gs)) return 6;
        if (canEnter(p + ivec2(1, 0), gs)) return 2;
    }
    return -1;
}

void main() {
    int gs = uGridSize;
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 c = texelFetch(uState, p, 0);
    vec4 tr = texelFetch(uTransferIn, p, 0);

    if (p.x <= 0 || p.y <= 0 || p.x >= gs - 1 || p.y >= gs - 1 || isSolid(c.g)) {
        outState = c;
        outTransfer = tr;
        return;
    }

    float leave = 0.0;
    int myDir = -1;
    if (isWater(c.g) || c.r > uTFloor) {
        myDir = chooseDir(p, gs, c.r);
        if (myDir >= 0) leave = min(uGrav, c.r);
    }

    float arrive = 0.0;
    for (int d = 0; d < 8; d++) {
        if (d != 0 && d != 1 && d != 7 && d != 2 && d != 6) continue;
        ivec2 src = p - dirOf(d);
        if (!inInner(src, gs)) continue;
        vec4 s = texelFetch(uState, src, 0);
        if (s.r <= uTFloor) continue;
        if (isSolid(s.g)) continue;
        int cd = chooseDir(src, gs, s.r);
        if (cd == d) arrive += min(uGrav, s.r);
    }

    float newMass = max(0.0, c.r - leave + arrive);
    float newType = isSolid(c.g) ? 1.0 : (newMass > uTFloor ? 2.0 : 0.0);

    float accX = tr.r;
    float accY = tr.g;
    float had = tr.b;
    if (leave > uTFloor && myDir >= 0) {
        vec2 nd = vec2(float(dirOf(myDir).x), float(dirOf(myDir).y)) * invDistOf(myDir);
        accX += nd.x * leave;
        accY += nd.y * leave;
        had = 1.0;
    }

    outState = vec4(newMass, newType, c.b, c.a);
    outTransfer = vec4(accX, accY, had, 0.0);
}
`;

const FS_FLOW = FS_COMMON + `
uniform sampler2D uTransfer;
uniform float uAlpha;
uniform float uSnapSq;
uniform float uMaxMag;

layout(location = 0) out vec4 outState;

void main() {
    int gs = uGridSize;
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 c = texelFetch(uState, p, 0);
    vec4 tr = texelFetch(uTransfer, p, 0);

    if (p.x <= 0 || p.y <= 0 || p.x >= gs - 1 || p.y >= gs - 1 || isSolid(c.g)) {
        outState = c;
        return;
    }

    float mass = c.r;
    float typ = c.g;
    if (!isWater(typ) || mass <= uTFloor) {
        outState = vec4(0.0, typ > 0.5 ? typ : 0.0, 0.0, 0.0);
        if (mass <= uTFloor && !isSolid(typ)) outState = vec4(0.0, 0.0, 0.0, 0.0);
        else if (isSolid(typ)) outState = c;
        return;
    }

    float tfx = 0.0;
    float tfy = 0.0;
    if (tr.b > 0.5) {
        tfx = tr.r;
        tfy = tr.g;
    }
    float vx = c.b + (tfx - c.b) * uAlpha;
    float vy = c.a + (tfy - c.a) * uAlpha;
    float lenSq = vx * vx + vy * vy;
    if (lenSq < uSnapSq) {
        vx = 0.0;
        vy = 0.0;
    } else if (uMaxMag > 0.0 && lenSq > uMaxMag * uMaxMag) {
        float s = uMaxMag / sqrt(lenSq);
        vx *= s;
        vy *= s;
    }
    outState = vec4(mass, 2.0, vx, vy);
}
`;

const FS_AVG = FS_COMMON + `
uniform float uBlend;
uniform int uWaterToAir;
uniform int uAirToWater;

layout(location = 0) out vec4 outState;

void main() {
    int gs = uGridSize;
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 c = texelFetch(uState, p, 0);

    if (p.x <= 0 || p.y <= 0 || p.x >= gs - 1 || p.y >= gs - 1 || isSolid(c.g)) {
        outState = c;
        return;
    }

    bool selfWater = isWater(c.g) && c.r > uTFloor;
    if (!selfWater && uWaterToAir == 0) {
        outState = c;
        return;
    }

    vec2 sum = vec2(0.0);
    float n = 0.0;
    for (int i = 0; i < 8; i++) {
        ivec2 np = p + dirOf(i);
        if (!inInner(np, gs)) continue;
        vec4 nb = texelFetch(uState, np, 0);
        if (isSolid(nb.g)) continue;
        bool nw = isWater(nb.g) && nb.r > uTFloor;
        if (selfWater) {
            if (!nw && uAirToWater == 0) continue;
        } else {
            if (!nw) continue;
        }
        sum += vec2(nb.b, nb.a);
        n += 1.0;
    }
    if (n < 0.5) {
        outState = c;
        return;
    }
    vec2 avg = sum / n;
    vec2 v = mix(vec2(c.b, c.a), avg, uBlend);
    float typ = selfWater ? 2.0 : c.g;
    if (!selfWater && uWaterToAir != 0) typ = c.g;
    outState = vec4(c.r, typ, v.x, v.y);
}
`;

const FS_WAKE = FS_COMMON + `
uniform int uChunkSize;
uniform float uSleepMass;
uniform float uSleepFlowSq;

layout(location = 0) out vec4 outWake;

void main() {
    ivec2 cxy = ivec2(gl_FragCoord.xy);
    int x0 = cxy.x * uChunkSize;
    int y0 = cxy.y * uChunkSize;
    int gs = uGridSize;
    float wake = 0.0;
    for (int dy = 0; dy < 32; dy++) {
        if (dy >= uChunkSize) break;
        for (int dx = 0; dx < 32; dx++) {
            if (dx >= uChunkSize) break;
            ivec2 p = ivec2(x0 + dx, y0 + dy);
            if (!inInner(p, gs)) continue;
            vec4 c = texelFetch(uState, p, 0);
            if (!isWater(c.g)) continue;
            if (c.r > uSleepMass) { wake = 1.0; break; }
            if ((c.b * c.b + c.a * c.a) > uSleepFlowSq) { wake = 1.0; break; }
        }
        if (wake > 0.5) break;
    }
    outWake = vec4(wake, 0.0, 0.0, 1.0);
}
`;

function linkProgram(vsSrc, fsSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('gpu-physics link:', gl.getProgramInfoLog(prog));
        return null;
    }
    return prog;
}

function cacheUniforms(prog, names) {
    prog._u = {};
    for (let i = 0; i < names.length; i++) {
        const n = names[i];
        prog._u[n] = gl.getUniformLocation(prog, n);
    }
}

function u(prog, name) {
    return prog._u[name];
}

function createRgba32fTex(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    return tex;
}

function ensureBlitFbos() {
    if (!gpuBlitReadFbo) {
        gpuBlitReadFbo = gl.createFramebuffer();
        gpuBlitDrawFbo = gl.createFramebuffer();
    }
}

function blitTexture(src, dst, w, h) {
    ensureBlitFbos();
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gpuBlitReadFbo);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src, 0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, gpuBlitDrawFbo);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
}

function clearTexture(tex, w, h) {
    ensureBlitFbos();
    gl.bindFramebuffer(gl.FRAMEBUFFER, gpuBlitDrawFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

function ensureGpuTransferTargets() {
    if (!gl) return;
    if (gpuTransferTex) gl.deleteTexture(gpuTransferTex);
    gpuTransferTex = createRgba32fTex(GRID_SIZE, GRID_SIZE);
}

function ensureGpuOutflowTargets() {
    if (!gl) return;
    if (gpuOutflowA) gl.deleteTexture(gpuOutflowA);
    if (gpuOutflowB) gl.deleteTexture(gpuOutflowB);
    gpuOutflowA = createRgba32fTex(GRID_SIZE, GRID_SIZE);
    gpuOutflowB = createRgba32fTex(GRID_SIZE, GRID_SIZE);
}

function ensureGpuWakeTarget() {
    if (!gl || chunksW <= 0 || chunksH <= 0) return;
    if (gpuWakeTex && gpuWakeW === chunksW && gpuWakeH === chunksH) return;
    if (gpuWakeTex) gl.deleteTexture(gpuWakeTex);
    if (gpuWakeFbo) gl.deleteFramebuffer(gpuWakeFbo);
    gpuWakeW = chunksW;
    gpuWakeH = chunksH;
    gpuWakeTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, gpuWakeTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gpuWakeW, gpuWakeH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gpuWakeFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, gpuWakeFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gpuWakeTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gpuWakeScratch = new Uint8Array(gpuWakeW * gpuWakeH * 4);
}

function initGpuPhysics() {
    gpuPhysReady = false;
    if (!gl || !webglAvailable) return;

    gpuProgFickOut = linkProgram(VS_SIM, FS_FICK_OUT);
    gpuProgFickGather = linkProgram(VS_SIM, FS_FICK_GATHER);
    gpuProgGrav = linkProgram(VS_SIM, FS_GRAV);
    gpuProgFlow = linkProgram(VS_SIM, FS_FLOW);
    gpuProgAvg = linkProgram(VS_SIM, FS_AVG);
    gpuProgWake = linkProgram(VS_SIM, FS_WAKE);
    if (!gpuProgFickOut || !gpuProgFickGather || !gpuProgGrav || !gpuProgFlow || !gpuProgAvg || !gpuProgWake) {
        console.warn('gpu-physics: compile failed — sim CPU');
        return;
    }

    cacheUniforms(gpuProgFickOut, ['uState', 'uGridSize', 'uRest', 'uTFloor', 'uD', 'uFlowInf']);
    cacheUniforms(gpuProgFickGather, ['uState', 'uGridSize', 'uRest', 'uTFloor', 'uOutA', 'uOutB']);
    cacheUniforms(gpuProgGrav, ['uState', 'uGridSize', 'uRest', 'uTFloor', 'uGrav', 'uStep', 'uTransferIn']);
    cacheUniforms(gpuProgFlow, ['uState', 'uGridSize', 'uRest', 'uTFloor', 'uTransfer', 'uAlpha', 'uSnapSq', 'uMaxMag']);
    cacheUniforms(gpuProgAvg, ['uState', 'uGridSize', 'uRest', 'uTFloor', 'uBlend', 'uWaterToAir', 'uAirToWater']);
    cacheUniforms(gpuProgWake, ['uState', 'uGridSize', 'uRest', 'uTFloor', 'uChunkSize', 'uSleepMass', 'uSleepFlowSq']);

    ensureGpuTransferTargets();
    ensureGpuOutflowTargets();
    ensureBlitFbos();
    ensureGpuWakeTarget();

    const bindQuad = (prog) => {
        gl.useProgram(prog);
        const aPos = gl.getAttribLocation(prog, 'aPos');
        gl.bindBuffer(gl.ARRAY_BUFFER, glQuadBuffer);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    };
    bindQuad(gpuProgFickOut);
    bindQuad(gpuProgFickGather);
    bindQuad(gpuProgGrav);
    bindQuad(gpuProgFlow);
    bindQuad(gpuProgAvg);
    bindQuad(gpuProgWake);

    gpuPhysReady = true;
}

function resizeGpuPhysics() {
    if (!gpuPhysReady) return;
    ensureGpuTransferTargets();
    ensureGpuOutflowTargets();
    ensureGpuWakeTarget();
    if (gpuPassGravity._trB) {
        gl.bindTexture(gl.TEXTURE_2D, gpuPassGravity._trB);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, GRID_SIZE, GRID_SIZE, 0, gl.RGBA, gl.FLOAT, null);
    } else {
        ensureGravTransferB();
    }
}

function isGpuSim() {
    return flags.simBackend === 'gpu' && gpuPhysReady && webglAvailable && stateTex;
}

function useChunkedDraw() {
    return flags.useChunkCulling && processChunkCount > 0 && processChunkCount < chunksTotal;
}

function drawSimPass() {
    gl.viewport(0, 0, GRID_SIZE, GRID_SIZE);
    if (!useChunkedDraw()) {
        gl.disable(gl.SCISSOR_TEST);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return;
    }
    gl.enable(gl.SCISSOR_TEST);
    forEachProcessChunk((_ci, x0, y0, x1, y1) => {
        gl.scissor(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    });
    gl.disable(gl.SCISSOR_TEST);
}

function bindSimProgram(prog) {
    gl.useProgram(prog);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadBuffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
}

function setCommonUniforms(prog) {
    gl.uniform1i(u(prog, 'uGridSize'), GRID_SIZE);
    gl.uniform1f(u(prog, 'uRest'), cfg.restCapacity);
    gl.uniform1f(u(prog, 'uTFloor'), transferFloor());
}

function blitState(read, write) {
    // Detach MRT extras from write FBO before blit
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    blitTexture(stateTex[read], stateTex[write], GRID_SIZE, GRID_SIZE);
}

/** Fick pass A: outflows → outflowA/B */
function gpuPassFickOut() {
    const read = stateIdx;

    bindSimProgram(gpuProgFickOut);
    setCommonUniforms(gpuProgFickOut);
    gl.uniform1f(u(gpuProgFickOut, 'uD'), cfg.diffusion);
    gl.uniform1f(u(gpuProgFickOut, 'uFlowInf'), cfg.flowInfluence);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
    gl.uniform1i(u(gpuProgFickOut, 'uState'), 0);

    if (useChunkedDraw()) {
        clearTexture(gpuOutflowA, GRID_SIZE, GRID_SIZE);
        clearTexture(gpuOutflowB, GRID_SIZE, GRID_SIZE);
    }

    ensureBlitFbos();
    gl.bindFramebuffer(gl.FRAMEBUFFER, gpuBlitDrawFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gpuOutflowA, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, gpuOutflowB, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    drawSimPass();
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
}

/** Fick pass B: gather mass + transfer */
function gpuPassFickGather() {
    const read = stateIdx;
    const write = 1 - stateIdx;

    if (useChunkedDraw()) blitState(read, write);
    clearTexture(gpuTransferTex, GRID_SIZE, GRID_SIZE);

    bindSimProgram(gpuProgFickGather);
    setCommonUniforms(gpuProgFickGather);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
    gl.uniform1i(u(gpuProgFickGather, 'uState'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gpuOutflowA);
    gl.uniform1i(u(gpuProgFickGather, 'uOutA'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, gpuOutflowB);
    gl.uniform1i(u(gpuProgFickGather, 'uOutB'), 2);

    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex[write], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, gpuTransferTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    drawSimPass();
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    stateIdx = write;
}

function gpuPassFick() {
    gpuPassFickOut();
    gpuPassFickGather();
}

function ensureGravTransferB() {
    if (gpuPassGravity._trB) return;
    gpuPassGravity._trB = createRgba32fTex(GRID_SIZE, GRID_SIZE);
}

function gpuPassGravity() {
    if (cfg.gravity <= 0) return;
    const read = stateIdx;
    const write = 1 - stateIdx;
    ensureGravTransferB();

    if (useChunkedDraw()) {
        blitState(read, write);
        blitTexture(gpuTransferTex, gpuPassGravity._trB, GRID_SIZE, GRID_SIZE);
    }

    bindSimProgram(gpuProgGrav);
    setCommonUniforms(gpuProgGrav);
    gl.uniform1f(u(gpuProgGrav, 'uGrav'), cfg.gravity);
    gl.uniform1i(u(gpuProgGrav, 'uStep'), runtime.totalSubstepsExecuted | 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
    gl.uniform1i(u(gpuProgGrav, 'uState'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gpuTransferTex);
    gl.uniform1i(u(gpuProgGrav, 'uTransferIn'), 1);

    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex[write], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, gpuPassGravity._trB, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    drawSimPass();
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    const tmp = gpuTransferTex;
    gpuTransferTex = gpuPassGravity._trB;
    gpuPassGravity._trB = tmp;

    stateIdx = write;
}

function gpuPassFlowfield() {
    const read = stateIdx;
    const write = 1 - stateIdx;

    if (useChunkedDraw()) blitState(read, write);

    bindSimProgram(gpuProgFlow);
    setCommonUniforms(gpuProgFlow);
    gl.uniform1f(u(gpuProgFlow, 'uAlpha'), cfg.lerp);
    gl.uniform1f(u(gpuProgFlow, 'uSnapSq'), cfg.flowSnapSq);
    gl.uniform1f(u(gpuProgFlow, 'uMaxMag'), cfg.flowMaxMag);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
    gl.uniform1i(u(gpuProgFlow, 'uState'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gpuTransferTex);
    gl.uniform1i(u(gpuProgFlow, 'uTransfer'), 1);

    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex[write], 0);
    drawSimPass();
    stateIdx = write;
}

function gpuPassFlowAvg() {
    const every = cfg.flowAvgEvery | 0;
    const blend = cfg.flowAvgBlend;
    if (every <= 0 || blend <= 0) return;
    if (runtime.totalSubstepsExecuted % every !== 0) return;

    const read = stateIdx;
    const write = 1 - stateIdx;

    if (useChunkedDraw()) blitState(read, write);

    bindSimProgram(gpuProgAvg);
    setCommonUniforms(gpuProgAvg);
    gl.uniform1f(u(gpuProgAvg, 'uBlend'), blend);
    gl.uniform1i(u(gpuProgAvg, 'uWaterToAir'), flags.flowAvgWaterToAir ? 1 : 0);
    gl.uniform1i(u(gpuProgAvg, 'uAirToWater'), flags.flowAvgAirToWater ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
    gl.uniform1i(u(gpuProgAvg, 'uState'), 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex[write], 0);
    drawSimPass();
    stateIdx = write;
}

function gpuPassWakeCommit() {
    ensureGpuWakeTarget();
    if (!gpuWakeFbo) return;

    bindSimProgram(gpuProgWake);
    setCommonUniforms(gpuProgWake);
    gl.uniform1i(u(gpuProgWake, 'uChunkSize'), CHUNK);
    gl.uniform1f(u(gpuProgWake, 'uSleepMass'), chunkSleepMass());
    gl.uniform1f(u(gpuProgWake, 'uSleepFlowSq'), chunkSleepFlowSq());

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[stateIdx]);
    gl.uniform1i(u(gpuProgWake, 'uState'), 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, gpuWakeFbo);
    gl.viewport(0, 0, gpuWakeW, gpuWakeH);
    gl.disable(gl.SCISSOR_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.readPixels(0, 0, gpuWakeW, gpuWakeH, gl.RGBA, gl.UNSIGNED_BYTE, gpuWakeScratch);

    chunkActiveScratch.fill(0);
    const n = chunksTotal;
    const src = gpuWakeScratch;
    for (let i = 0; i < n; i++) {
        if (src[i * 4] > 0) chunkActiveScratch[i] = 1;
    }
    commitChunkActivity(true);
}

function updatePhysicsSubstepGpu() {
    runtime.totalSubstepsExecuted++;
    buildProcessChunkList();
    if (processChunkCount === 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return;
    }
    chunkActiveScratch.fill(0);
    gpuPassFick();
    gpuPassGravity();
    gpuPassFlowfield();
    gpuPassFlowAvg();
    gpuPassWakeCommit();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
