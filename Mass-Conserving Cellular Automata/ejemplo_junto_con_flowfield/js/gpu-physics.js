/**
 * gpu-physics.js — Física en WebGL2 (fragment ping-pong).
 * Orden substep: Fick gather → gravedad approx → flowfield (+ avg opcional).
 *
 * State RGBA32F: R=mass G=type B=flowX A=flowY
 * Transfer RGBA32F: R=accX G=accY B=had A=0
 *
 * ponytail: gravedad ≠ falling-sand bit-exact (sin barrido bottom-up);
 * upgrade: más passes / WebGPU atomics.
 */
'use strict';

let gpuPhysReady = false;
let gpuProgFick = null;
let gpuProgGrav = null;
let gpuProgFlow = null;
let gpuProgAvg = null;
let gpuTransferTex = null;

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

const FS_FICK_CLEAN = FS_COMMON + `
uniform float uD;
uniform float uFlowInf;

layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outTransfer;

void cellOutflows(ivec2 p, int gs, out float o0, out float o1, out float o2, out float o3,
                  out float o4, out float o5, out float o6, out float o7, out float sumOut) {
    o0 = o1 = o2 = o3 = o4 = o5 = o6 = o7 = 0.0;
    sumOut = 0.0;
    vec4 c = texelFetch(uState, p, 0);
    if (!isWater(c.g)) return;
    float mass = c.r;
    if (mass < uRest) return;
    float Ci = mass - uRest;
    if (Ci <= uTFloor && uFlowInf <= 0.0) return;
    vec2 f = vec2(c.b, c.a);

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
    o0 *= scale; o1 *= scale; o2 *= scale; o3 *= scale;
    o4 *= scale; o5 *= scale; o6 *= scale; o7 *= scale;
    sumOut *= scale;
}

float outflowDir(ivec2 p, int dir, int gs) {
    float o0, o1, o2, o3, o4, o5, o6, o7, s;
    cellOutflows(p, gs, o0, o1, o2, o3, o4, o5, o6, o7, s);
    if (dir == 0) return o0;
    if (dir == 1) return o1;
    if (dir == 2) return o2;
    if (dir == 3) return o3;
    if (dir == 4) return o4;
    if (dir == 5) return o5;
    if (dir == 6) return o6;
    return o7;
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

    float o0, o1, o2, o3, o4, o5, o6, o7, sumOut;
    cellOutflows(p, gs, o0, o1, o2, o3, o4, o5, o6, o7, sumOut);

    float accX = 0.0, accY = 0.0, had = 0.0;
    if (o0 > uTFloor) { accX += 0.0 * o0; accY += 1.0 * o0; had = 1.0; }
    if (o1 > uTFloor) { accX += 0.70710678118 * o1; accY += 0.70710678118 * o1; had = 1.0; }
    if (o2 > uTFloor) { accX += 1.0 * o2; accY += 0.0 * o2; had = 1.0; }
    if (o3 > uTFloor) { accX += 0.70710678118 * o3; accY += -0.70710678118 * o3; had = 1.0; }
    if (o4 > uTFloor) { accX += 0.0 * o4; accY += -1.0 * o4; had = 1.0; }
    if (o5 > uTFloor) { accX += -0.70710678118 * o5; accY += -0.70710678118 * o5; had = 1.0; }
    if (o6 > uTFloor) { accX += -1.0 * o6; accY += 0.0 * o6; had = 1.0; }
    if (o7 > uTFloor) { accX += -0.70710678118 * o7; accY += 0.70710678118 * o7; had = 1.0; }

    float sumIn = 0.0;
    for (int i = 0; i < 8; i++) {
        ivec2 np = p + dirOf(i);
        if (!inInner(np, gs)) continue;
        // from np to p: opposite of i
        sumIn += outflowDir(np, (i + 4) % 8, gs);
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

// Returns direction index of chosen move, or -1. Priority: down, diags, laterals.
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
    // sources that might choose us: up(4), upL(3), upR(5), left(2), right(6) in their dir space
    // neighbor at p - dirOf(d) chooses direction d to land on p
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

function ensureGpuTransferTargets() {
    if (!gl) return;
    if (gpuTransferTex) gl.deleteTexture(gpuTransferTex);
    gpuTransferTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, gpuTransferTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, GRID_SIZE, GRID_SIZE, 0, gl.RGBA, gl.FLOAT, null);
}

function initGpuPhysics() {
    gpuPhysReady = false;
    if (!gl || !webglAvailable) return;

    gpuProgFick = linkProgram(VS_SIM, FS_FICK_CLEAN);
    gpuProgGrav = linkProgram(VS_SIM, FS_GRAV);
    gpuProgFlow = linkProgram(VS_SIM, FS_FLOW);
    gpuProgAvg = linkProgram(VS_SIM, FS_AVG);
    if (!gpuProgFick || !gpuProgGrav || !gpuProgFlow || !gpuProgAvg) {
        console.warn('gpu-physics: compile failed — sim CPU');
        return;
    }

    ensureGpuTransferTargets();

    // Bind fullscreen quad attrib for sim programs
    const bindQuad = (prog) => {
        gl.useProgram(prog);
        const aPos = gl.getAttribLocation(prog, 'aPos');
        gl.bindBuffer(gl.ARRAY_BUFFER, glQuadBuffer);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    };
    bindQuad(gpuProgFick);
    bindQuad(gpuProgGrav);
    bindQuad(gpuProgFlow);
    bindQuad(gpuProgAvg);

    gpuPhysReady = true;
}

function resizeGpuPhysics() {
    if (!gpuPhysReady) return;
    ensureGpuTransferTargets();
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

function drawSimPass() {
    gl.viewport(0, 0, GRID_SIZE, GRID_SIZE);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function bindSimProgram(prog) {
    gl.useProgram(prog);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadBuffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
}

function setCommonUniforms(prog) {
    gl.uniform1i(gl.getUniformLocation(prog, 'uGridSize'), GRID_SIZE);
    gl.uniform1f(gl.getUniformLocation(prog, 'uRest'), cfg.restCapacity);
    gl.uniform1f(gl.getUniformLocation(prog, 'uTFloor'), transferFloor());
}

/** Fick: read stateIdx → write 1-stateIdx + transferTex (MRT) */
function gpuPassFick() {
    const read = stateIdx;
    const write = 1 - stateIdx;

    bindSimProgram(gpuProgFick);
    setCommonUniforms(gpuProgFick);
    gl.uniform1f(gl.getUniformLocation(gpuProgFick, 'uD'), cfg.diffusion);
    gl.uniform1f(gl.getUniformLocation(gpuProgFick, 'uFlowInf'), cfg.flowInfluence);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
    gl.uniform1i(gl.getUniformLocation(gpuProgFick, 'uState'), 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex[write], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, gpuTransferTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    drawSimPass();
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    stateIdx = write;
}

function ensureGravTransferB() {
    if (gpuPassGravity._trB) return;
    gpuPassGravity._trB = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, gpuPassGravity._trB);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, GRID_SIZE, GRID_SIZE, 0, gl.RGBA, gl.FLOAT, null);
}

function gpuPassGravity() {
    if (cfg.gravity <= 0) return;
    const read = stateIdx;
    const write = 1 - stateIdx;
    ensureGravTransferB();

    bindSimProgram(gpuProgGrav);
    setCommonUniforms(gpuProgGrav);
    gl.uniform1f(gl.getUniformLocation(gpuProgGrav, 'uGrav'), cfg.gravity);
    gl.uniform1i(gl.getUniformLocation(gpuProgGrav, 'uStep'), runtime.totalSubstepsExecuted | 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
    gl.uniform1i(gl.getUniformLocation(gpuProgGrav, 'uState'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gpuTransferTex);
    gl.uniform1i(gl.getUniformLocation(gpuProgGrav, 'uTransferIn'), 1);

    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex[write], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, gpuPassGravity._trB, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    drawSimPass();
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    // swap transfer tex pointers
    const tmp = gpuTransferTex;
    gpuTransferTex = gpuPassGravity._trB;
    gpuPassGravity._trB = tmp;

    stateIdx = write;
}

function gpuPassFlowfield() {
    const read = stateIdx;
    const write = 1 - stateIdx;

    bindSimProgram(gpuProgFlow);
    setCommonUniforms(gpuProgFlow);
    gl.uniform1f(gl.getUniformLocation(gpuProgFlow, 'uAlpha'), cfg.lerp);
    gl.uniform1f(gl.getUniformLocation(gpuProgFlow, 'uSnapSq'), cfg.flowSnapSq);
    gl.uniform1f(gl.getUniformLocation(gpuProgFlow, 'uMaxMag'), cfg.flowMaxMag);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
    gl.uniform1i(gl.getUniformLocation(gpuProgFlow, 'uState'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gpuTransferTex);
    gl.uniform1i(gl.getUniformLocation(gpuProgFlow, 'uTransfer'), 1);

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

    bindSimProgram(gpuProgAvg);
    setCommonUniforms(gpuProgAvg);
    gl.uniform1f(gl.getUniformLocation(gpuProgAvg, 'uBlend'), blend);
    gl.uniform1i(gl.getUniformLocation(gpuProgAvg, 'uWaterToAir'), flags.flowAvgWaterToAir ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(gpuProgAvg, 'uAirToWater'), flags.flowAvgAirToWater ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
    gl.uniform1i(gl.getUniformLocation(gpuProgAvg, 'uState'), 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex[write], 0);
    drawSimPass();
    stateIdx = write;
}

function updatePhysicsSubstepGpu() {
    runtime.totalSubstepsExecuted++;
    gpuPassFick();
    gpuPassGravity();
    gpuPassFlowfield();
    gpuPassFlowAvg();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
