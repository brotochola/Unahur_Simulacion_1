/**
 * perf.js — Timers wall-clock + flush a badges (~0.5s).
 */
'use strict';

const perf = {
    frameAccum: 0,
    simAccum: 0,
    renderAccum: 0,
    gpuAccum: 0,
    gpuSamples: 0,
    count: 0,
    lastFlush: performance.now(),
    _t0: 0,
    gpuAvailable: false,
};

function perfBegin() {
    perf._t0 = performance.now();
}

function perfEnd(bucket) {
    const dt = performance.now() - perf._t0;
    if (bucket === 'frame') perf.frameAccum += dt;
    else if (bucket === 'sim') perf.simAccum += dt;
    else if (bucket === 'render') perf.renderAccum += dt;
}

function perfRecordGpuMs(ms) {
    if (!(ms >= 0)) return;
    perf.gpuAccum += ms;
    perf.gpuSamples++;
    perf.gpuAvailable = true;
}

function perfMarkGpuUnavailable() {
    perf.gpuAvailable = false;
}

function perfFrameTick() {
    perf.count++;
    const now = performance.now();
    if (now - perf.lastFlush < 500) return;

    const n = Math.max(1, perf.count);
    const fps = Math.round((n * 1000) / (now - perf.lastFlush));
    const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    set('fpsDisplay', `${fps} FPS`);
    set('simDisplay', `Sim: ${(perf.simAccum / n).toFixed(2)} ms`);
    set('renderDisplay', `Rend: ${(perf.renderAccum / n).toFixed(2)} ms`);
    set('frameDisplay', `Frame: ${(perf.frameAccum / n).toFixed(2)} ms`);
    if (perf.gpuSamples > 0) {
        set('gpuDisplay', `GPU: ${(perf.gpuAccum / perf.gpuSamples).toFixed(2)} ms`);
    } else if (isWebGLBackend && isWebGLBackend()) {
        set('gpuDisplay', 'GPU: …');
    } else {
        set('gpuDisplay', 'GPU: n/a');
    }

    perf.frameAccum = 0;
    perf.simAccum = 0;
    perf.renderAccum = 0;
    perf.gpuAccum = 0;
    perf.gpuSamples = 0;
    perf.count = 0;
    perf.lastFlush = now;
}
