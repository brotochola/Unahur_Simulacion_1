/**
 * chunks.js — Spatial hash / culling (port de 4.html).
 * Solo procesamos chunks con agua/flujo + anillo 3×3 (vecinos pueden recibir masa).
 */
'use strict';

let chunksW = 0;
let chunksH = 0;
let chunksTotal = 0;

let chunkHasWater = new Uint8Array(0);
let chunkProcess = new Uint8Array(0);
let chunkQuiet = new Uint8Array(0);
let chunkActiveScratch = new Uint8Array(0);
/** Lista densa de chunks a procesar (Int32, sin GC) */
let processChunkList = new Int32Array(0);
let processChunkCount = 0;

function chunkIndex(cx, cy) {
    return cx + cy * chunksW;
}

/** Umbral de masa para sleep: no contar niebla sub-visual */
function chunkSleepMass() {
    return Math.max(cfg.minFlow, 0.01 * cfg.restCapacity);
}

function chunkSleepFlowSq() {
    return (cfg.flowSnapSq > 0) ? cfg.flowSnapSq : 1e-4;
}

function cellWakesChunk(mass, vx, vy) {
    if (mass > chunkSleepMass()) return true;
    return (vx * vx + vy * vy) > chunkSleepFlowSq();
}

function allocChunkBuffers() {
    chunksW = Math.ceil(GRID_SIZE / CHUNK);
    chunksH = Math.ceil(GRID_SIZE / CHUNK);
    chunksTotal = chunksW * chunksH;
    chunkHasWater = new Uint8Array(chunksTotal);
    chunkProcess = new Uint8Array(chunksTotal);
    chunkQuiet = new Uint8Array(chunksTotal);
    chunkActiveScratch = new Uint8Array(chunksTotal);
    processChunkList = new Int32Array(chunksTotal);
    processChunkCount = 0;
}

/** Despierta chunk si la celda tiene masa visible */
function markChunkAtCell(x, y, mass) {
    if (mass <= chunkSleepMass()) return;
    const ci = chunkIndex((x / CHUNK) | 0, (y / CHUNK) | 0);
    chunkHasWater[ci] = 1;
    chunkQuiet[ci] = 0;
    if (ci < chunkActiveScratch.length) chunkActiveScratch[ci] = 1;
}

/**
 * Commit scratch → flags con hysteresis.
 * useHysteresis=true: necesita QUIET_FRAMES quietos para dormir.
 */
function commitChunkActivity(useHysteresis) {
    for (let i = 0; i < chunksTotal; i++) {
        if (chunkActiveScratch[i]) {
            chunkHasWater[i] = 1;
            chunkQuiet[i] = 0;
        } else if (!useHysteresis) {
            chunkHasWater[i] = 0;
            chunkQuiet[i] = 0;
        } else if (chunkHasWater[i]) {
            const q = chunkQuiet[i] + 1;
            chunkQuiet[i] = q > 255 ? 255 : q;
            if (q >= QUIET_FRAMES) {
                chunkHasWater[i] = 0;
                chunkQuiet[i] = 0;
            }
        }
    }
}

function countAliveChunks() {
    let n = 0;
    for (let i = 0; i < chunksTotal; i++) if (chunkHasWater[i]) n++;
    return n;
}

/** Full-grid sync (pintura / resize). Sin hysteresis. */
function rebuildChunkFlagsFromWater() {
    chunkActiveScratch.fill(0);
    const gs = GRID_SIZE;
    const m = massRead;
    for (let y = 1; y < gs - 1; y++) {
        for (let x = 1; x < gs - 1; x++) {
            const idx = x + y * gs;
            if (typeGrid[idx] !== WATER) continue;
            if (cellWakesChunk(m[idx], flowX[idx], flowY[idx])) {
                chunkActiveScratch[chunkIndex((x / CHUNK) | 0, (y / CHUNK) | 0)] = 1;
            }
        }
    }
    commitChunkActivity(false);
}

function reconfigureChunks(newChunkSize) {
    CHUNK = newChunkSize;
    allocChunkBuffers();
    rebuildChunkFlagsFromWater();
    buildProcessChunkList();
}

/**
 * Construye lista de chunks a procesar:
 * - culling OFF → todos
 * - culling ON → vivos + anillo 3×3
 */
function buildProcessChunkList() {
    chunkProcess.fill(0);
    processChunkCount = 0;

    if (!flags.useChunkCulling) {
        for (let ci = 0; ci < chunksTotal; ci++) {
            chunkProcess[ci] = 1;
            processChunkList[processChunkCount++] = ci;
        }
    } else {
        for (let cy = 0; cy < chunksH; cy++) {
            for (let cx = 0; cx < chunksW; cx++) {
                const ci = chunkIndex(cx, cy);
                if (!chunkHasWater[ci]) continue;
                for (let oy = -1; oy <= 1; oy++) {
                    for (let ox = -1; ox <= 1; ox++) {
                        const nx = cx + ox;
                        const ny = cy + oy;
                        if (nx < 0 || ny < 0 || nx >= chunksW || ny >= chunksH) continue;
                        const ni = chunkIndex(nx, ny);
                        if (!chunkProcess[ni]) {
                            chunkProcess[ni] = 1;
                            processChunkList[processChunkCount++] = ni;
                        }
                    }
                }
            }
        }
    }

    const el = document.getElementById('chunkDisplay');
    if (el) {
        const alive = countAliveChunks();
        el.textContent = `Chunks: ${alive}/${chunksTotal}`;
        el.title = `Activos: ${alive}. En proceso (anillo): ${processChunkCount}/${chunksTotal}. Quiet=${QUIET_FRAMES}`;
    }
}

/**
 * Bounds interiores (sin borde sólido) de un chunk.
 * Devuelve false si el rect queda vacío.
 */
function processChunkInteriorBounds(ci, out) {
    const gs = GRID_SIZE;
    const cx = ci % chunksW;
    const cy = (ci / chunksW) | 0;
    const x0 = Math.max(1, cx * CHUNK);
    const y0 = Math.max(1, cy * CHUNK);
    const x1 = Math.min(gs - 2, cx * CHUNK + CHUNK - 1);
    const y1 = Math.min(gs - 2, cy * CHUNK + CHUNK - 1);
    if (x0 > x1 || y0 > y1) return false;
    out[0] = x0;
    out[1] = y0;
    out[2] = x1;
    out[3] = y1;
    return true;
}

/** Bounds de texels del chunk en la grilla (incluye borde). */
function chunkPixelBounds(ci, out) {
    const gs = GRID_SIZE;
    const cx = ci % chunksW;
    const cy = (ci / chunksW) | 0;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const x1 = Math.min(gs, x0 + CHUNK) - 1;
    const y1 = Math.min(gs, y0 + CHUNK) - 1;
    if (x0 > x1 || y0 > y1) return false;
    out[0] = x0;
    out[1] = y0;
    out[2] = x1;
    out[3] = y1;
    return true;
}

const _chunkBoundsScratch = new Int32Array(4);

/**
 * Itera chunks en processChunkList con bounds interiores.
 * fn(ci, x0, y0, x1, y1)
 */
function forEachProcessChunk(fn) {
    const b = _chunkBoundsScratch;
    for (let i = 0; i < processChunkCount; i++) {
        const ci = processChunkList[i];
        if (!processChunkInteriorBounds(ci, b)) continue;
        fn(ci, b[0], b[1], b[2], b[3]);
    }
}

/** Copia src→dst solo en celdas interiores de processChunkList. */
function copyProcessCells(src, dst) {
    const gs = GRID_SIZE;
    forEachProcessChunk((_ci, x0, y0, x1, y1) => {
        for (let y = y0; y <= y1; y++) {
            const row = y * gs;
            dst.set(src.subarray(row + x0, row + x1 + 1), row + x0);
        }
    });
}

function clearProcessCellsFloat(arr) {
    const gs = GRID_SIZE;
    forEachProcessChunk((_ci, x0, y0, x1, y1) => {
        for (let y = y0; y <= y1; y++) {
            arr.fill(0, y * gs + x0, y * gs + x1 + 1);
        }
    });
}

function clearProcessCellsByte(arr) {
    clearProcessCellsFloat(arr);
}

/**
 * Itera celdas interiores de los chunks en processChunkList.
 * fn(x, y, idx) — sin alloc.
 */
function forEachProcessCell(fn) {
    const gs = GRID_SIZE;
    forEachProcessChunk((_ci, x0, y0, x1, y1) => {
        for (let y = y0; y <= y1; y++) {
            const row = y * gs;
            for (let x = x0; x <= x1; x++) {
                fn(x, y, x + row);
            }
        }
    });
}
