/**
 * renderer.js — Dual backend:
 *  - imagedata: Canvas2D + Uint32 pixelBuffer + putImageData por runs
 *  - webgl: state textures RGBA32F (sim/render GPU) + colorize fullscreen
 * Overlay debug siempre en Canvas2D aparte.
 */
'use strict';

const simCanvasCpu = document.getElementById('simCanvasCpu');
const simCanvasGpu = document.getElementById('simCanvasGpu');
const debugCanvas = document.getElementById('debugCanvas');
const vectorCanvas = document.getElementById('vectorCanvas');
const canvasStack = document.getElementById('canvasStack');

const debugCtx = debugCanvas.getContext('2d');
const vectorCtx = vectorCanvas.getContext('2d');

let displayW = 150;
let displayH = 150;
let cellPx = 1;

/** Estado WebGL (canvas GPU dedicado) */
let gl = null;
let glProgram = null;
let glQuadBuffer = null;
/** Ping-pong state: R=mass G=type B=flowX A=flowY */
let stateTex = null;
let stateFbo = null;
let stateIdx = 0;
let gpuStateResident = false;
let uMode = null;
let uRest = null;
let uVelScale = null;
let uPressureRed = null;
let uFoamVelScale = null;
let uNbMassRef = null;
let uNbFoamThresh = null;
let uNbVelWhite = null;
let uTexel = null;
let webglAvailable = false;
/** GPU timer query (async, frame-1) */
let glTimerExt = null;
let glTimerQuery = null;
let glTimerWaiting = false;
let _readPixelScratch = new Float32Array(4);
let _readMassScratch = null;

/** ImageData (canvas CPU dedicado) */
let simCtx2d = null;
let imgData = null;
let pixelBuffer = null;
let cpuReady = false;

/** Dirty upload: flush global o solo chunks en proceso (+ frame anterior) */
let renderFullDirty = true;
let dirtyChunkRGBA = new Float32Array(0);
let prevRenderChunkList = new Int32Array(0);
let prevRenderChunkCount = 0;
let renderDirtyList = new Int32Array(0);
let renderDirtyCount = 0;
let renderDirtyMark = new Uint8Array(0);
let sortedDirtyList = new Int32Array(0);
const _packSizeOut = new Int32Array(4); // w, h, x0, y0

function markRenderFullDirty() {
    renderFullDirty = true;
}

function ensureRenderDirtyBuffers() {
    if (renderDirtyMark.length !== chunksTotal) {
        renderDirtyMark = new Uint8Array(chunksTotal);
        renderDirtyList = new Int32Array(chunksTotal);
        sortedDirtyList = new Int32Array(chunksTotal);
        prevRenderChunkList = new Int32Array(chunksTotal);
        prevRenderChunkCount = 0;
    }
    // Hasta una fila entera de chunks (merge horizontal)
    const need = GRID_SIZE * CHUNK * 4;
    if (dirtyChunkRGBA.length < need) dirtyChunkRGBA = new Float32Array(need);
}

function buildRenderDirtyList() {
    ensureRenderDirtyBuffers();
    renderDirtyMark.fill(0);
    renderDirtyCount = 0;
    const add = (ci) => {
        if (ci < 0 || ci >= chunksTotal || renderDirtyMark[ci]) return;
        renderDirtyMark[ci] = 1;
        renderDirtyList[renderDirtyCount++] = ci;
    };
    for (let i = 0; i < processChunkCount; i++) add(processChunkList[i]);
    for (let i = 0; i < prevRenderChunkCount; i++) add(prevRenderChunkList[i]);
}

function commitRenderDirtyPrev() {
    ensureRenderDirtyBuffers();
    for (let i = 0; i < processChunkCount; i++) prevRenderChunkList[i] = processChunkList[i];
    prevRenderChunkCount = processChunkCount;
}

function useFullRenderUpload() {
    return renderFullDirty || !flags.useChunkCulling || renderDirtyCount > (chunksTotal >> 2);
}

/** Ordena dirty por ci (row-major) y llama fn(x0,y0,x1,y1) por run horizontal contiguo. */
function forEachDirtyMergedRun(fn) {
    const n = renderDirtyCount;
    if (n === 0) return;
    const sorted = sortedDirtyList;
    for (let i = 0; i < n; i++) sorted[i] = renderDirtyList[i];
    // insertion sort — n chico (decenas–cientos)
    for (let i = 1; i < n; i++) {
        const v = sorted[i];
        let j = i - 1;
        while (j >= 0 && sorted[j] > v) {
            sorted[j + 1] = sorted[j];
            j--;
        }
        sorted[j + 1] = v;
    }

    const gs = GRID_SIZE;
    let i = 0;
    while (i < n) {
        const ci0 = sorted[i];
        const cy = (ci0 / chunksW) | 0;
        let cx0 = ci0 % chunksW;
        let cx1 = cx0;
        i++;
        while (i < n) {
            const ci = sorted[i];
            const cy2 = (ci / chunksW) | 0;
            const cx = ci % chunksW;
            if (cy2 !== cy || cx !== cx1 + 1) break;
            cx1 = cx;
            i++;
        }
        const x0 = cx0 * CHUNK;
        const y0 = cy * CHUNK;
        const x1 = Math.min(gs, (cx1 + 1) * CHUNK) - 1;
        const y1 = Math.min(gs, y0 + CHUNK) - 1;
        if (x0 <= x1 && y0 <= y1) fn(x0, y0, x1, y1);
    }
}

function isWebGLBackend() {
    return flags.rendererBackend === 'webgl' && webglAvailable;
}

function applyRendererVisibility() {
    const gpu = isWebGLBackend();
    if (simCanvasGpu) simCanvasGpu.classList.toggle('is-hidden', !gpu);
    if (simCanvasCpu) simCanvasCpu.classList.toggle('is-hidden', gpu);
}

/** Cambia backend; flush full al siguiente frame. */
function setRendererBackend(backend) {
    if (backend === 'webgl' && !webglAvailable) {
        backend = 'imagedata';
        const sel = document.getElementById('selectRenderer');
        if (sel) sel.value = 'imagedata';
    }
    if (backend !== 'webgl' && backend !== 'imagedata') backend = 'imagedata';
    flags.rendererBackend = backend;
    applyRendererVisibility();
    markRenderFullDirty();
}

const VS_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
    vUv = aPos * 0.5 + 0.5;
    // Flip Y: grilla tiene Y+ abajo, WebGL Y+ arriba
    vUv.y = 1.0 - vUv.y;
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform int uMode;      // 0 mass, 1 velocity, 2 pressure, 3 compress, 4 water, 5 waterNb
uniform float uRest;
uniform float uVelScale;
uniform float uPressureRed;
uniform float uFoamVelScale;
uniform float uNbMassRef;
uniform float uNbFoamThresh;
uniform float uNbVelWhite;
uniform float uTexel;
out vec4 fragColor;

vec3 colorMass(float ratio) {
    if (ratio <= 1.0) {
        float t = clamp(ratio, 0.0, 1.0);
        return vec3(20.0 + t * 25.0, 50.0 + t * 90.0, 110.0 + t * 120.0) / 255.0;
    }
    float t = clamp((ratio - 1.0) / 2.0, 0.0, 1.0);
    return vec3(30.0 + t * 50.0, 140.0 + t * 80.0, 255.0) / 255.0;
}

// Verde oscuro (< reposo) → verde (reposo) → rojo (masa >= uPressureRed = max celda)
vec3 colorPressure(float mass, float rest, float redAt) {
    vec3 darkGreen = vec3(8.0, 40.0, 12.0) / 255.0;
    vec3 green = vec3(40.0, 200.0, 60.0) / 255.0;
    vec3 red = vec3(230.0, 30.0, 25.0) / 255.0;
    if (mass < rest) {
        float t = clamp(mass / rest, 0.0, 1.0);
        return mix(darkGreen, green, t);
    }
    float span = max(redAt - rest, 1e-6);
    float t = clamp((mass - rest) / span, 0.0, 1.0);
    return mix(green, red, t);
}

vec3 colorVelocity(float t) {
    t = clamp(t, 0.0, 1.0);
    return vec3(30.0 + t * 225.0, 80.0 + t * 175.0, 200.0 + t * 55.0) / 255.0;
}

vec3 colorCompress(float ratio) {
    float t = clamp(ratio, 0.0, 1.0);
    return vec3(t, 200.0 * (1.0 - t) / 255.0, 1.0);
}

vec3 colorWater(float mass, float rest, float vx, float vy) {
    float ratio = mass / rest;
    vec3 deep = vec3(8.0, 40.0, 90.0) / 255.0;
    vec3 mid = vec3(20.0, 110.0, 190.0) / 255.0;
    vec3 light = vec3(90.0, 190.0, 230.0) / 255.0;
    vec3 base;
    if (ratio <= 1.0) {
        base = mix(deep, mid, clamp(ratio, 0.0, 1.0));
    } else {
        base = mix(mid, light, clamp((ratio - 1.0) / 2.0, 0.0, 1.0));
    }

    float edgeFoam = 0.0;
    float tL = texture(uTex, vUv + vec2(-uTexel, 0.0)).g;
    float tR = texture(uTex, vUv + vec2( uTexel, 0.0)).g;
    float tU = texture(uTex, vUv + vec2(0.0, -uTexel)).g;
    float tD = texture(uTex, vUv + vec2(0.0,  uTexel)).g;
    if (tL < 0.5 || tR < 0.5 || tU < 0.5 || tD < 0.5) {
        edgeFoam = 0.55;
    }

    float speed = length(vec2(vx, vy));
    float speedFoam = smoothstep(0.08, 0.55, speed * uFoamVelScale * 0.12);
    float excess = max(0.0, mass - rest);
    float excessFoam = smoothstep(0.15, 0.8, excess / rest) * 0.35;
    float foam = clamp(edgeFoam + speedFoam + excessFoam, 0.0, 1.0);
    return mix(base, vec3(1.0), foam);
}

// Agua vecinos: masa→oscuro, borde AIR→espuma, avg mag² vecinos→claro (sin sqrt)
vec3 colorWaterNb(float mass) {
    float t = uTexel;
    vec4 c0 = texture(uTex, vUv);
    vec4 cL = texture(uTex, vUv + vec2(-t,  0.0));
    vec4 cR = texture(uTex, vUv + vec2( t,  0.0));
    vec4 cU = texture(uTex, vUv + vec2(0.0, -t));
    vec4 cD = texture(uTex, vUv + vec2(0.0,  t));
    vec4 cLU = texture(uTex, vUv + vec2(-t, -t));
    vec4 cRU = texture(uTex, vUv + vec2( t, -t));
    vec4 cLD = texture(uTex, vUv + vec2(-t,  t));
    vec4 cRD = texture(uTex, vUv + vec2( t,  t));

    float edgeFoam = 0.0;
    if (cL.g < 0.5 || cR.g < 0.5 || cU.g < 0.5 || cD.g < 0.5 ||
        cLU.g < 0.5 || cRU.g < 0.5 || cLD.g < 0.5 || cRD.g < 0.5) {
        edgeFoam = 1.0;
    }

    float avgMagSq = (
        c0.b * c0.b + c0.a * c0.a +
        cL.b * cL.b + cL.a * cL.a +
        cR.b * cR.b + cR.a * cR.a +
        cU.b * cU.b + cU.a * cU.a +
        cD.b * cD.b + cD.a * cD.a +
        cLU.b * cLU.b + cLU.a * cLU.a +
        cRU.b * cRU.b + cRU.a * cRU.a +
        cLD.b * cLD.b + cLD.a * cLD.a +
        cRD.b * cRD.b + cRD.a * cRD.a
    ) * (1.0 / 9.0);

    float rest = max(uRest, 1e-6);
    float ref = max(uNbMassRef, 1e-6);
    float massT = clamp(mass / (rest * ref), 0.0, 1.0);

    vec3 deep = vec3(0.02, 0.08, 0.30);
    vec3 mid = vec3(0.08, 0.40, 0.85);
    vec3 foam = vec3(0.75, 0.92, 1.0);
    vec3 base = mix(mid, deep, massT);

    float edgeAmt = edgeFoam * clamp(uNbFoamThresh, 0.0, 1.0);
    vec3 col = mix(base, foam, edgeAmt);

    float velRef = max(uNbVelWhite, 1e-6);
    float velT = smoothstep(0.0, velRef, avgMagSq);
    col = mix(col, foam, velT);
    return col;
}

void main() {
    vec4 s = texture(uTex, vUv);
    float mass = s.r;
    float typ = s.g; // 0 air, 1 solid, 2 water
    float vx = s.b;
    float vy = s.a;

    if (typ < 0.5) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    if (typ < 1.5) {
        fragColor = vec4(0.23, 0.20, 0.18, 1.0); // SOLID
        return;
    }

    // WATER
    if (mass <= 0.0) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    float rest = max(uRest, 1e-6);
    vec3 col;
    if (uMode == 1) {
        float lenSq = vx * vx + vy * vy;
        col = colorVelocity(lenSq * uVelScale);
    } else if (uMode == 2) {
        col = colorPressure(mass, rest, uPressureRed);
    } else if (uMode == 3) {
        col = colorCompress(max(0.0, mass - rest) / rest);
    } else if (uMode == 4) {
        col = colorWater(mass, rest, vx, vy);
    } else if (uMode == 5) {
        col = colorWaterNb(mass);
    } else {
        col = colorMass(mass / rest);
    }
    fragColor = vec4(col, 1.0);
}`;

function compileShader(glCtx, type, src) {
    const sh = glCtx.createShader(type);
    glCtx.shaderSource(sh, src);
    glCtx.compileShader(sh);
    if (!glCtx.getShaderParameter(sh, glCtx.COMPILE_STATUS)) {
        console.error(glCtx.getShaderInfoLog(sh));
        glCtx.deleteShader(sh);
        return null;
    }
    return sh;
}

function initCpuRenderer() {
    simCtx2d = simCanvasCpu.getContext('2d', { alpha: false, willReadFrequently: false });
    if (!simCtx2d) {
        console.error('Canvas2D no disponible');
        cpuReady = false;
        return;
    }
    imgData = simCtx2d.createImageData(GRID_SIZE, GRID_SIZE);
    pixelBuffer = new Uint32Array(imgData.data.buffer);
    cpuReady = true;
}

function createStateTexture() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, GRID_SIZE, GRID_SIZE, 0, gl.RGBA, gl.FLOAT, null);
    return tex;
}

function resizeStateTextures() {
    if (!gl || !stateTex) return;
    gl.getExtension('EXT_color_buffer_float');
    for (let i = 0; i < 2; i++) {
        gl.bindTexture(gl.TEXTURE_2D, stateTex[i]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, GRID_SIZE, GRID_SIZE, 0, gl.RGBA, gl.FLOAT, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex[i], 0);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.warn('FBO state incompleto', status);
            webglAvailable = false;
            return;
        }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
        console.warn('RGBA32F no soportado — desactivo WebGL', err);
        webglAvailable = false;
        return;
    }
    webglAvailable = true;
    stateIdx = 0;
    gpuStateResident = false;
}

function initGpuRenderer() {
    gl = simCanvasGpu.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) {
        console.warn('WebGL2 no disponible — solo ImageData');
        webglAvailable = false;
        return;
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VS_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_SRC);
    if (!vs || !fs) {
        webglAvailable = false;
        return;
    }

    glProgram = gl.createProgram();
    gl.attachShader(glProgram, vs);
    gl.attachShader(glProgram, fs);
    gl.linkProgram(glProgram);
    if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(glProgram));
        webglAvailable = false;
        return;
    }

    gl.useProgram(glProgram);

    glQuadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(glProgram, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    stateTex = [createStateTexture(), createStateTexture()];
    stateFbo = [gl.createFramebuffer(), gl.createFramebuffer()];
    resizeStateTextures();
    if (!webglAvailable) return;

    gl.uniform1i(gl.getUniformLocation(glProgram, 'uTex'), 0);
    uMode = gl.getUniformLocation(glProgram, 'uMode');
    uRest = gl.getUniformLocation(glProgram, 'uRest');
    uVelScale = gl.getUniformLocation(glProgram, 'uVelScale');
    uPressureRed = gl.getUniformLocation(glProgram, 'uPressureRed');
    uFoamVelScale = gl.getUniformLocation(glProgram, 'uFoamVelScale');
    uNbMassRef = gl.getUniformLocation(glProgram, 'uNbMassRef');
    uNbFoamThresh = gl.getUniformLocation(glProgram, 'uNbFoamThresh');
    uNbVelWhite = gl.getUniformLocation(glProgram, 'uNbVelWhite');
    uTexel = gl.getUniformLocation(glProgram, 'uTexel');

    glTimerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (glTimerExt) glTimerQuery = gl.createQuery();
}

function initRenderer() {
    initCpuRenderer();
    initGpuRenderer();
    if (typeof initGpuPhysics === 'function') initGpuPhysics();
    if (!webglAvailable && flags.rendererBackend === 'webgl') {
        flags.rendererBackend = 'imagedata';
    }
    if (!webglAvailable || (typeof gpuPhysReady !== 'undefined' && !gpuPhysReady)) {
        if (flags.simBackend === 'gpu') flags.simBackend = 'cpu';
    }
    const sel = document.getElementById('selectRenderer');
    if (sel) {
        sel.value = flags.rendererBackend;
        if (!webglAvailable) {
            const opt = sel.querySelector('option[value="webgl"]');
            if (opt) {
                opt.disabled = true;
                opt.textContent = 'GPU (WebGL2 no disponible)';
            }
            sel.value = 'imagedata';
            flags.rendererBackend = 'imagedata';
        }
    }
    const selSim = document.getElementById('selectSimBackend');
    if (selSim) {
        selSim.value = flags.simBackend;
        if (!webglAvailable || !gpuPhysReady) {
            const opt = selSim.querySelector('option[value="gpu"]');
            if (opt) {
                opt.disabled = true;
                opt.textContent = 'GPU (no disponible)';
            }
            selSim.value = 'cpu';
            flags.simBackend = 'cpu';
        }
    }
    applyRendererVisibility();
    markRenderFullDirty();
    uploadCpuStateToGpu();
}

/** Empaqueta CPU SoA → uploadRGBA y sube a stateTex[stateIdx]. */
function uploadCpuStateToGpu() {
    if (!webglAvailable || !gl || !stateTex) return;
    packUploadTexture();
    gl.bindTexture(gl.TEXTURE_2D, stateTex[stateIdx]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID_SIZE, GRID_SIZE, gl.RGBA, gl.FLOAT, uploadRGBA);
    gpuStateResident = true;
    markRenderFullDirty();
}

/** Sube rectángulo [x0..x1]×[y0..y1] desde CPU arrays a state actual. */
function uploadCpuRectToGpu(x0, y0, x1, y1) {
    if (!webglAvailable || !gl || !stateTex) return;
    const sizeOut = _packSizeOut;
    packRectRGBA(x0, y0, x1, y1, dirtyChunkRGBA, sizeOut);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[stateIdx]);
    gl.texSubImage2D(
        gl.TEXTURE_2D, 0,
        sizeOut[2], sizeOut[3],
        sizeOut[0], sizeOut[1],
        gl.RGBA, gl.FLOAT, dirtyChunkRGBA
    );
    gpuStateResident = true;
}

/** Descarga state GPU → CPU SoA (inspector overlays / switch a CPU sim). */
function downloadGpuStateToCpu() {
    if (!webglAvailable || !gl || !stateTex) return;
    const n = TOTAL_CELLS * 4;
    if (!_readMassScratch || _readMassScratch.length !== n) {
        _readMassScratch = new Float32Array(n);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[stateIdx]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex[stateIdx], 0);
    gl.readPixels(0, 0, GRID_SIZE, GRID_SIZE, gl.RGBA, gl.FLOAT, _readMassScratch);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const src = _readMassScratch;
    let maxMass = 0;
    for (let i = 0, o = 0; i < TOTAL_CELLS; i++, o += 4) {
        const mass = src[o];
        const typ = src[o + 1] | 0;
        massRead[i] = mass;
        typeGrid[i] = typ;
        flowX[i] = src[o + 2];
        flowY[i] = src[o + 3];
        if (typ === WATER && mass > maxMass) maxMass = mass;
    }
    massWrite.set(massRead);
    runtime.maxCellMass = maxMass;
    syncPressureRedAtFromMax(maxMass);
}

function readGpuCell(x, y, out) {
    if (!webglAvailable || !gl || !stateTex) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[stateIdx]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex[stateIdx], 0);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, _readPixelScratch);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    out[0] = _readPixelScratch[0];
    out[1] = _readPixelScratch[1];
    out[2] = _readPixelScratch[2];
    out[3] = _readPixelScratch[3];
    return true;
}

function totalMassGpu() {
    if (!webglAvailable || !gl || !stateTex) return totalMass();
    const n = TOTAL_CELLS * 4;
    if (!_readMassScratch || _readMassScratch.length !== n) {
        _readMassScratch = new Float32Array(n);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[stateIdx]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex[stateIdx], 0);
    gl.readPixels(0, 0, GRID_SIZE, GRID_SIZE, gl.RGBA, gl.FLOAT, _readMassScratch);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let sum = 0;
    let maxMass = 0;
    const src = _readMassScratch;
    for (let i = 0, o = 0; i < TOTAL_CELLS; i++, o += 4) {
        const mass = src[o];
        sum += mass;
        if ((src[o + 1] | 0) === WATER && mass > maxMass) maxMass = mass;
    }
    runtime.maxCellMass = maxMass;
    syncPressureRedAtFromMax(maxMass);
    return sum;
}

function pollGpuTimer() {
    if (!glTimerExt || !glTimerQuery || !glTimerWaiting) return;
    if (!gl.getQueryParameter(glTimerQuery, gl.QUERY_RESULT_AVAILABLE)) return;
    if (gl.getParameter(glTimerExt.GPU_DISJOINT_EXT)) {
        glTimerWaiting = false;
        return;
    }
    const ns = gl.getQueryParameter(glTimerQuery, gl.QUERY_RESULT);
    glTimerWaiting = false;
    if (typeof perfRecordGpuMs === 'function') perfRecordGpuMs(ns / 1e6);
}

function modeToInt(mode) {
    if (mode === 'velocity') return 1;
    if (mode === 'pressure') return 2;
    if (mode === 'compress') return 3;
    if (mode === 'water') return 4;
    if (mode === 'waterNb') return 5;
    return 0;
}

/** Empaqueta mass/type/flowX/flowY en uploadRGBA (full-grid); actualiza max masa WATER. */
function packUploadTexture() {
    const n = TOTAL_CELLS;
    const m = flags.useTemporalSmooth ? displayMassGrid : massRead;
    const fx = flags.useTemporalSmooth ? displayFlowX : flowX;
    const fy = flags.useTemporalSmooth ? displayFlowY : flowY;
    const out = uploadRGBA;
    const types = typeGrid;
    let o = 0;
    let maxMass = 0;
    for (let i = 0; i < n; i++) {
        const mass = m[i];
        out[o++] = mass;
        out[o++] = types[i];
        out[o++] = fx[i];
        out[o++] = fy[i];
        if (types[i] === WATER && mass > maxMass) maxMass = mass;
    }
    runtime.maxCellMass = maxMass;
    syncPressureRedAtFromMax(maxMass);
}

/**
 * Empaqueta rectángulo [x0..x1]×[y0..y1] contiguo en `out` (w*h*4 floats).
 * Escribe sizeOut: [w, h, x0, y0].
 */
function packRectRGBA(x0, y0, x1, y1, out, sizeOut) {
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const gs = GRID_SIZE;
    const m = flags.useTemporalSmooth ? displayMassGrid : massRead;
    const fx = flags.useTemporalSmooth ? displayFlowX : flowX;
    const fy = flags.useTemporalSmooth ? displayFlowY : flowY;
    const types = typeGrid;
    let o = 0;
    for (let y = y0; y <= y1; y++) {
        const row = y * gs;
        for (let x = x0; x <= x1; x++) {
            const idx = x + row;
            out[o++] = m[idx];
            out[o++] = types[idx];
            out[o++] = fx[idx];
            out[o++] = fy[idx];
        }
    }
    sizeOut[0] = w;
    sizeOut[1] = h;
    sizeOut[2] = x0;
    sizeOut[3] = y0;
}

/** Max masa WATER en lista de chunks (pixel bounds). */
function maxMassFromChunkList(list, count) {
    const gs = GRID_SIZE;
    const m = flags.useTemporalSmooth ? displayMassGrid : massRead;
    const types = typeGrid;
    const b = _chunkBoundsScratch;
    let maxMass = 0;
    for (let i = 0; i < count; i++) {
        if (!chunkPixelBounds(list[i], b)) continue;
        for (let y = b[1]; y <= b[3]; y++) {
            const row = y * gs;
            for (let x = b[0]; x <= b[2]; x++) {
                const idx = x + row;
                if (types[idx] === WATER && m[idx] > maxMass) maxMass = m[idx];
            }
        }
    }
    return maxMass;
}

/** Solo sube el max del slider a max masa/celda; no toca el valor del usuario. */
function syncPressureRedAtFromMax(maxMass) {
    const knob = document.getElementById('knobPressureRedAt');
    if (!knob) return;
    const hi = Math.max(cfg.restCapacity, maxMass);
    const hiRounded = Math.max(0.1, Math.ceil(hi * 10) / 10);
    if (parseFloat(knob.max) !== hiRounded) knob.max = String(hiRounded);
    // Si el valor del usuario quedó arriba del nuevo max (masa bajó), clamp al max
    const cur = parseFloat(knob.value);
    if (cur > hiRounded) {
        knob.value = String(hiRounded);
        cfg.pressureRedAt = hiRounded;
        const label = document.getElementById('valPressureRedAt');
        if (label) label.textContent = hiRounded.toFixed(2);
    }
}

function fitCanvasStack() {
    const parent = canvasStack.parentElement;
    if (!parent) return;
    const bar = parent.querySelector('.playback-bar');
    const barH = bar ? bar.offsetHeight + 8 : 52;
    const availW = parent.clientWidth - 16;
    const availH = parent.clientHeight - barH - 16;
    const side = Math.max(64, Math.floor(Math.min(availW, availH)));
    canvasStack.style.width = side + 'px';
    canvasStack.style.height = side + 'px';
}

function resizeDebugCanvas() {
    fitCanvasStack();
    const rect = canvasStack.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (w === displayW && h === displayH && debugCanvas.width === w) {
        cellPx = displayW / GRID_SIZE;
        return;
    }
    displayW = w;
    displayH = h;
    debugCanvas.width = displayW;
    debugCanvas.height = displayH;
    cellPx = displayW / GRID_SIZE;
}

function onGridResized() {
    simCanvasCpu.width = GRID_SIZE;
    simCanvasCpu.height = GRID_SIZE;
    simCanvasGpu.width = GRID_SIZE;
    simCanvasGpu.height = GRID_SIZE;
    if (cpuReady && simCtx2d) {
        imgData = simCtx2d.createImageData(GRID_SIZE, GRID_SIZE);
        pixelBuffer = new Uint32Array(imgData.data.buffer);
    }
    if (webglAvailable && gl) {
        resizeStateTextures();
        if (typeof resizeGpuPhysics === 'function') resizeGpuPhysics();
        gl.viewport(0, 0, GRID_SIZE, GRID_SIZE);
        gpuStateResident = false;
    }
    displayW = 0;
    resizeDebugCanvas();
    markRenderFullDirty();
    prevRenderChunkCount = 0;
}

function packRGB(r, g, b) {
    return 0xFF000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
}

function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

function colorMassCPU(ratio) {
    if (ratio <= 1) {
        const t = clamp01(ratio);
        return packRGB(20 + t * 25, 50 + t * 90, 110 + t * 120);
    }
    const t = clamp01((ratio - 1) / 2);
    return packRGB(30 + t * 50, 140 + t * 80, 255);
}

function lerpRGB(r0, g0, b0, r1, g1, b1, t) {
    const u = clamp01(t);
    return packRGB(r0 + (r1 - r0) * u, g0 + (g1 - g0) * u, b0 + (b1 - b0) * u);
}

function colorPressureCPU(mass, rest, redAt) {
    if (mass < rest) {
        return lerpRGB(8, 40, 12, 40, 200, 60, mass / Math.max(rest, MASS_EPS));
    }
    const span = Math.max(redAt - rest, MASS_EPS);
    return lerpRGB(40, 200, 60, 230, 30, 25, (mass - rest) / span);
}

function smoothstep(edge0, edge1, x) {
    const t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}

function colorWaterCPU(mass, rest, vx, vy, x, y, gs) {
    const ratio = mass / Math.max(rest, MASS_EPS);
    let br, bg, bb;
    if (ratio <= 1) {
        const t = clamp01(ratio);
        br = 8 + (20 - 8) * t;
        bg = 40 + (110 - 40) * t;
        bb = 90 + (190 - 90) * t;
    } else {
        const t = clamp01((ratio - 1) / 2);
        br = 20 + (90 - 20) * t;
        bg = 110 + (190 - 110) * t;
        bb = 190 + (230 - 190) * t;
    }

    let edgeFoam = 0;
    if (x > 0 && typeGrid[x - 1 + y * gs] === AIR) edgeFoam = 0.55;
    else if (x < gs - 1 && typeGrid[x + 1 + y * gs] === AIR) edgeFoam = 0.55;
    else if (y > 0 && typeGrid[x + (y - 1) * gs] === AIR) edgeFoam = 0.55;
    else if (y < gs - 1 && typeGrid[x + (y + 1) * gs] === AIR) edgeFoam = 0.55;

    const speed = Math.hypot(vx, vy);
    const speedFoam = smoothstep(0.08, 0.55, speed * cfg.foamVelScale * 0.12);
    const excess = Math.max(0, mass - rest);
    const excessFoam = smoothstep(0.15, 0.8, excess / Math.max(rest, MASS_EPS)) * 0.35;
    const foam = clamp01(edgeFoam + speedFoam + excessFoam);
    return packRGB(br + (255 - br) * foam, bg + (255 - bg) * foam, bb + (255 - bb) * foam);
}

function colorWaterNbCPU(mass, x, y, gs, rest, m, fx, fy) {
    let edgeFoam = 0;
    let sumMagSq = 0;
    for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= gs || ny < 0 || ny >= gs) continue;
            const ni = nx + ny * gs;
            if ((dx !== 0 || dy !== 0) && typeGrid[ni] === AIR) edgeFoam = 1;
            const vx = fx[ni];
            const vy = fy[ni];
            sumMagSq += vx * vx + vy * vy;
        }
    }
    const avgMagSq = sumMagSq * (1 / 9);
    const ref = Math.max(cfg.nbMassRef, MASS_EPS);
    const massT = clamp01(mass / (Math.max(rest, MASS_EPS) * ref));

    // mid (0.08, 0.40, 0.85) ↔ deep (0.02, 0.08, 0.30)
    let br = (0.08 + (0.02 - 0.08) * massT) * 255;
    let bg = (0.40 + (0.08 - 0.40) * massT) * 255;
    let bb = (0.85 + (0.30 - 0.85) * massT) * 255;

    const foamR = 0.75 * 255, foamG = 0.92 * 255, foamB = 255;
    const edgeAmt = edgeFoam * clamp01(cfg.nbFoamThresh);
    br = br + (foamR - br) * edgeAmt;
    bg = bg + (foamG - bg) * edgeAmt;
    bb = bb + (foamB - bb) * edgeAmt;

    const velRef = Math.max(cfg.nbVelWhite, MASS_EPS);
    const velT = smoothstep(0, velRef, avgMagSq);
    br = br + (foamR - br) * velT;
    bg = bg + (foamG - bg) * velT;
    bb = bb + (foamB - bb) * velT;
    return packRGB(br, bg, bb);
}

function colorCellCPU(idx, x, y, gs, rest, mode, velScale, redAt, m, fx, fy) {
    const COLOR_SOLID = 0xFF3A332E;
    const COLOR_AIR = 0xFF000000;
    const t = typeGrid[idx];
    if (t === SOLID) return COLOR_SOLID;
    if (t !== WATER) return COLOR_AIR;
    const mass = m[idx];
    if (isDeadMass(mass)) return COLOR_AIR;
    if (mode === 'velocity') {
        const lenSq = fx[idx] * fx[idx] + fy[idx] * fy[idx];
        const tt = clamp01(lenSq * velScale);
        return packRGB(30 + tt * 225, 80 + tt * 175, 200 + tt * 55);
    }
    if (mode === 'pressure') return colorPressureCPU(mass, rest, redAt);
    if (mode === 'compress') {
        const excess = Math.max(0, mass - rest);
        const tt = clamp01(excess / Math.max(rest, MASS_EPS));
        return packRGB(tt * 255, 200 * (1 - tt), 255);
    }
    if (mode === 'water') return colorWaterCPU(mass, rest, fx[idx], fy[idx], x, y, gs);
    if (mode === 'waterNb') return colorWaterNbCPU(mass, x, y, gs, rest, m, fx, fy);
    return colorMassCPU(mass / Math.max(rest, MASS_EPS));
}

function renderImageData(full) {
    if (!cpuReady) return;
    const rest = cfg.restCapacity;
    const mode = flags.renderMode;
    const velScale = cfg.velColorScale;
    const m = flags.useTemporalSmooth ? displayMassGrid : massRead;
    const fx = flags.useTemporalSmooth ? displayFlowX : flowX;
    const fy = flags.useTemporalSmooth ? displayFlowY : flowY;
    const gs = GRID_SIZE;

    let maxMass;
    if (full) {
        maxMass = 0;
        for (let i = 0; i < TOTAL_CELLS; i++) {
            if (typeGrid[i] === WATER && m[i] > maxMass) maxMass = m[i];
        }
    } else {
        maxMass = maxMassFromChunkList(renderDirtyList, renderDirtyCount);
    }
    runtime.maxCellMass = maxMass;
    syncPressureRedAtFromMax(maxMass);
    const redAt = cfg.pressureRedAt;

    if (full) {
        for (let i = 0; i < TOTAL_CELLS; i++) {
            const x = i % gs;
            const y = (i / gs) | 0;
            pixelBuffer[i] = colorCellCPU(i, x, y, gs, rest, mode, velScale, redAt, m, fx, fy);
        }
        simCtx2d.putImageData(imgData, 0, 0);
        return;
    }

    // Colorea + sube por runs horizontales (menos putImageData que 1/chunk)
    forEachDirtyMergedRun((x0, y0, x1, y1) => {
        for (let y = y0; y <= y1; y++) {
            const row = y * gs;
            for (let x = x0; x <= x1; x++) {
                const idx = x + row;
                pixelBuffer[idx] = colorCellCPU(idx, x, y, gs, rest, mode, velScale, redAt, m, fx, fy);
            }
        }
        simCtx2d.putImageData(imgData, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    });
}

function renderWebGL(_full) {
    if (!webglAvailable || !gl || !stateTex) return;
    pollGpuTimer();

    // CPU sim: subir state antes de colorize. GPU sim: state ya residente.
    if (!isGpuSim()) {
        if (_full || !gpuStateResident) uploadCpuStateToGpu();
        else {
            const maxMass = maxMassFromChunkList(renderDirtyList, renderDirtyCount);
            runtime.maxCellMass = maxMass;
            syncPressureRedAtFromMax(maxMass);
            const sizeOut = _packSizeOut;
            forEachDirtyMergedRun((x0, y0, x1, y1) => {
                packRectRGBA(x0, y0, x1, y1, dirtyChunkRGBA, sizeOut);
                gl.bindTexture(gl.TEXTURE_2D, stateTex[stateIdx]);
                gl.texSubImage2D(
                    gl.TEXTURE_2D, 0,
                    sizeOut[2], sizeOut[3],
                    sizeOut[0], sizeOut[1],
                    gl.RGBA, gl.FLOAT, dirtyChunkRGBA
                );
            });
            gpuStateResident = true;
        }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(glProgram);
    gl.viewport(0, 0, GRID_SIZE, GRID_SIZE);

    const aPos = gl.getAttribLocation(glProgram, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadBuffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[stateIdx]);
    gl.uniform1i(gl.getUniformLocation(glProgram, 'uTex'), 0);
    gl.uniform1i(uMode, modeToInt(flags.renderMode));
    gl.uniform1f(uRest, cfg.restCapacity);
    gl.uniform1f(uVelScale, cfg.velColorScale);
    gl.uniform1f(uPressureRed, cfg.pressureRedAt);
    gl.uniform1f(uFoamVelScale, cfg.foamVelScale);
    gl.uniform1f(uNbMassRef, cfg.nbMassRef);
    gl.uniform1f(uNbFoamThresh, cfg.nbFoamThresh);
    gl.uniform1f(uNbVelWhite, cfg.nbVelWhite);
    gl.uniform1f(uTexel, 1.0 / GRID_SIZE);

    const useTimer = glTimerExt && glTimerQuery && !glTimerWaiting;
    if (useTimer) {
        gl.beginQuery(glTimerExt.TIME_ELAPSED_EXT, glTimerQuery);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (useTimer) {
        gl.endQuery(glTimerExt.TIME_ELAPSED_EXT);
        glTimerWaiting = true;
    } else if (!glTimerExt && typeof perfMarkGpuUnavailable === 'function') {
        perfMarkGpuUnavailable();
    }
}

function renderOverlays() {
    resizeDebugCanvas();
    debugCtx.clearRect(0, 0, displayW, displayH);
    const px = cellPx;
    const gs = GRID_SIZE;
    const tFloor = transferFloor();
    const tFloorSq = tFloor * tFloor;

    if (flags.showGrid) {
        const step = cfg.gridStep;
        debugCtx.strokeStyle = 'rgba(255,255,255,0.08)';
        debugCtx.lineWidth = 1;
        debugCtx.beginPath();
        for (let x = 0; x <= gs; x += step) {
            const sx = x * px;
            debugCtx.moveTo(sx, 0);
            debugCtx.lineTo(sx, displayH);
        }
        for (let y = 0; y <= gs; y += step) {
            const sy = y * px;
            debugCtx.moveTo(0, sy);
            debugCtx.lineTo(displayW, sy);
        }
        debugCtx.stroke();
    }

    if (flags.showChunks && chunksTotal > 0) {
        const chunkPx = CHUNK * px;
        for (let cy = 0; cy < chunksH; cy++) {
            for (let cx = 0; cx < chunksW; cx++) {
                const ci = chunkIndex(cx, cy);
                const x = cx * CHUNK * px;
                const y = cy * CHUNK * px;
                const w = Math.min(chunkPx, displayW - x);
                const h = Math.min(chunkPx, displayH - y);
                if (chunkHasWater[ci]) {
                    debugCtx.fillStyle = 'rgba(0,255,120,0.14)';
                    debugCtx.fillRect(x, y, w, h);
                    debugCtx.strokeStyle = 'rgba(0,240,255,0.55)';
                    debugCtx.lineWidth = 1;
                    debugCtx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
                } else if (chunkProcess[ci]) {
                    debugCtx.strokeStyle = 'rgba(0,255,120,0.22)';
                    debugCtx.lineWidth = 1;
                    debugCtx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
                } else {
                    debugCtx.fillStyle = 'rgba(255,0,0,0.04)';
                    debugCtx.fillRect(x, y, w, h);
                }
            }
        }
    }

    if (flags.showFlowfield) {
        const arrowStep = cfg.arrowStep;
        const scale = cfg.flowDebugScale * px;
        const drawSnap = Math.max(cfg.flowSnapSq, tFloorSq);
        const m = massRead;
        debugCtx.strokeStyle = '#00f0ff';
        debugCtx.lineWidth = 1;
        debugCtx.beginPath();
        for (let y = 1; y < gs - 1; y += arrowStep) {
            for (let x = 1; x < gs - 1; x += arrowStep) {
                const idx = x + y * gs;
                if (typeGrid[idx] !== WATER) continue;
                if (isDeadMass(m[idx])) continue;
                const vx = flowX[idx];
                const vy = flowY[idx];
                if (vx * vx + vy * vy <= drawSnap) continue;
                const cx = (x + 0.5) * px;
                const cy = (y + 0.5) * px;
                debugCtx.moveTo(cx, cy);
                debugCtx.lineTo(cx + vx * scale, cy + vy * scale);
            }
        }
        debugCtx.stroke();
    }

    const mx = runtime.mouseX;
    const my = runtime.mouseY;
    if (mx >= 0 && mx < gs && my >= 0 && my < gs) {
        debugCtx.strokeStyle = '#ef4444';
        debugCtx.lineWidth = 1.5;
        debugCtx.strokeRect(mx * px, my * px, px, px);
    }
}

function updateDisplaySmooth(full) {
    if (!flags.useTemporalSmooth) return;

    const a = cfg.displayLerp;
    const gs = GRID_SIZE;
    const b = _chunkBoundsScratch;

    if (full) {
        const n = TOTAL_CELLS;
        for (let i = 0; i < n; i++) {
            displayMassGrid[i] += (massRead[i] - displayMassGrid[i]) * a;
            displayFlowX[i] += (flowX[i] - displayFlowX[i]) * a;
            displayFlowY[i] += (flowY[i] - displayFlowY[i]) * a;
        }
        return;
    }

    for (let i = 0; i < renderDirtyCount; i++) {
        if (!chunkPixelBounds(renderDirtyList[i], b)) continue;
        for (let y = b[1]; y <= b[3]; y++) {
            const row = y * gs;
            for (let x = b[0]; x <= b[2]; x++) {
                const idx = x + row;
                displayMassGrid[idx] += (massRead[idx] - displayMassGrid[idx]) * a;
                displayFlowX[idx] += (flowX[idx] - displayFlowX[idx]) * a;
                displayFlowY[idx] += (flowY[idx] - displayFlowY[idx]) * a;
            }
        }
    }
}

function render() {
    buildRenderDirtyList();
    const full = useFullRenderUpload();
    // Temporal smooth solo path CPU (GPU sim no mantiene display* buffers)
    if (!isGpuSim()) updateDisplaySmooth(full);
    if (isWebGLBackend()) renderWebGL(full);
    else {
        if (isGpuSim()) downloadGpuStateToCpu();
        renderImageData(true);
    }
    commitRenderDirtyPrev();
    renderFullDirty = false;
    // Overlays flechas/chunks necesitan SoA CPU
    if (isGpuSim() && (flags.showFlowfield || flags.showChunks)) {
        downloadGpuStateToCpu();
    }
    renderOverlays();
    updateInspectorUI();
}
