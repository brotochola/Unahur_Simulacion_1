/**
 * smoke-check.js — Prueba headless de física (Node).
 * Ejecutar: node js/smoke-check.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;

const fakeEl = () => ({
    textContent: '',
    title: '',
    style: {},
    value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getContext() {
        return {
            clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
            fillRect() {}, strokeRect() {},
            createImageData(w, h) {
                return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
            },
            putImageData() {},
        };
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 150, height: 150 }; },
    width: 150, height: 150,
    parentElement: { clientWidth: 400, clientHeight: 400, querySelector() { return null; } },
});

const elements = {};
const context = {
    console,
    Math,
    Float32Array,
    Uint8Array,
    Uint32Array,
    Int32Array,
    performance: { now: () => Date.now() },
    requestAnimationFrame() {},
    document: {
        getElementById(id) {
            if (!elements[id]) elements[id] = fakeEl();
            return elements[id];
        },
        querySelectorAll() { return []; },
    },
    window: { onmouseup: null, addEventListener() {}, ResizeObserver: undefined },
};

vm.createContext(context);

for (const f of ['config.js', 'grids.js', 'chunks.js', 'physics.js']) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    vm.runInContext(code, context, { filename: f });
}

function run(code) {
    return vm.runInContext(code, context);
}

run(`
allocateGrids(64);
allocChunkBuffers();
initGrid();
cfg.gravity = 0;
cfg.diffusion = 0.15;
cfg.restCapacity = 1.0;
cfg.minFlow = 0.001;
cfg.flowInfluence = 0;
flags.useChunkCulling = false;
`);

run(`
(function() {
    const gs = GRID_SIZE;
    for (let y = 20; y < 30; y++) {
        for (let x = 20; x < 30; x++) {
            const idx = x + y * gs;
            typeGrid[idx] = WATER;
            massRead[idx] = 2.0;
            markChunkAtCell(x, y, 2.0);
        }
    }
    massWrite.set(massRead);
    rebuildChunkFlagsFromWater();
    buildProcessChunkList();
})();
`);

const m0 = run('totalMass()');
run('for (let i = 0; i < 40; i++) updatePhysicsSubstep();');
const m1 = run('totalMass()');
const conservErr = Math.abs(m1 - m0);

const lowAfter = run(`
(function() {
    initGrid();
    cfg.gravity = 0;
    cfg.diffusion = 0.2;
    const g = GRID_SIZE;
    const idxLow = 10 + 10 * g;
    typeGrid[idxLow] = WATER;
    massRead[idxLow] = 0.5;
    massWrite.set(massRead);
    markChunkAtCell(10, 10, 0.5);
    rebuildChunkFlagsFromWater();
    buildProcessChunkList();
    for (let i = 0; i < 20; i++) updatePhysicsSubstep();
    return massRead[idxLow];
})();
`);

const spreadAlive = run(`
(function() {
    initGrid();
    cfg.gravity = 0;
    const g = GRID_SIZE;
    const iA = 15 + 15 * g;
    const iB = 16 + 15 * g;
    typeGrid[iA] = WATER;
    massRead[iA] = 2.0;
    massWrite.set(massRead);
    markChunkAtCell(15, 15, 2.0);
    rebuildChunkFlagsFromWater();
    buildProcessChunkList();
    for (let i = 0; i < 30; i++) updatePhysicsSubstep();
    let alive = 0;
    for (let i = 0; i < chunksTotal; i++) if (chunkHasWater[i]) alive++;
    return {
        spread: massRead[iB] + massRead[iA + g] + massRead[iA - g],
        alive: alive
    };
})();
`);
const spread = spreadAlive.spread;
const alive = spreadAlive.alive;

const swapped = run(`
(function() {
    const before = massRead;
    swapMassBuffers();
    const ok = massRead !== before;
    swapMassBuffers();
    return ok;
})();
`);

const cullConserv = run(`
(function() {
    initGrid();
    flags.useChunkCulling = true;
    cfg.gravity = 0;
    cfg.diffusion = 0.15;
    cfg.flowInfluence = 0;
    const gs = GRID_SIZE;
    for (let y = 20; y < 28; y++) {
        for (let x = 20; x < 28; x++) {
            const idx = x + y * gs;
            typeGrid[idx] = WATER;
            massRead[idx] = 2.0;
            markChunkAtCell(x, y, 2.0);
        }
    }
    massWrite.set(massRead);
    rebuildChunkFlagsFromWater();
    buildProcessChunkList();
    const before = totalMass();
    for (let i = 0; i < 40; i++) updatePhysicsSubstep();
    return Math.abs(totalMass() - before);
})();
`);

let failed = 0;
function check(name, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) failed++;
}

check('conservacion masa (Fick, g=0)', conservErr < 1e-3, `err=${conservErr.toFixed(6)} m0=${m0.toFixed(3)} m1=${m1.toFixed(3)}`);
check('bajo reposo no pierde por Fick', Math.abs(lowAfter - 0.5) < 1e-4, `mass=${lowAfter}`);
check('exceso se difunde a vecinos', spread > 0.01, `spread=${spread.toFixed(4)}`);
check('chunks vivos con agua', alive > 0, `alive=${alive}`);
check('swap ping-pong O(1)', swapped, '');
check('conservacion con culling (copy parcial)', cullConserv < 1e-3, `err=${cullConserv}`);

if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
}
console.log('\nAll smoke checks passed.');
