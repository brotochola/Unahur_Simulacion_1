/**
 * grids.js — SoA con typed arrays + doble buffer Jacobi (ping/pong).
 * Índice lineal: idx = x + y * GRID_SIZE (fila-major → buena localidad al barrer X).
 */
'use strict';

let GRID_SIZE = 150;
let TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
let CHUNK = 16;

/** Tipo de celda */
let typeGrid = new Uint8Array(0);

/** Doble buffer de masa (Jacobi): leer uno, escribir el otro, swap al final del paso Fick */
let massPing = new Float32Array(0);
let massPong = new Float32Array(0);
/** Referencias activas (no copian datos; solo apuntan) */
let massRead = massPing;
let massWrite = massPong;

/** Flowfield (inercial, un solo buffer) */
let flowX = new Float32Array(0);
let flowY = new Float32Array(0);

/** Exceso cacheado: max(0, m - rest) desde massRead */
let pressureGrid = new Float32Array(0);

/** Buffers de display (suavizado temporal opcional) */
let displayMassGrid = new Float32Array(0);
let displayFlowX = new Float32Array(0);
let displayFlowY = new Float32Array(0);

/** Empaquetado RGBA32F para upload WebGL (reutilizado, sin GC) */
let uploadRGBA = new Float32Array(0);

/**
 * Reserva / redimensiona todos los buffers SoA.
 * Llamar al cambiar tamaño de mundo.
 */
function allocateGrids(size) {
    GRID_SIZE = size;
    TOTAL_CELLS = size * size;

    typeGrid = new Uint8Array(TOTAL_CELLS);
    massPing = new Float32Array(TOTAL_CELLS);
    massPong = new Float32Array(TOTAL_CELLS);
    massRead = massPing;
    massWrite = massPong;

    flowX = new Float32Array(TOTAL_CELLS);
    flowY = new Float32Array(TOTAL_CELLS);
    pressureGrid = new Float32Array(TOTAL_CELLS);

    displayMassGrid = new Float32Array(TOTAL_CELLS);
    displayFlowX = new Float32Array(TOTAL_CELLS);
    displayFlowY = new Float32Array(TOTAL_CELLS);

    uploadRGBA = new Float32Array(TOTAL_CELLS * 4);
}

/** Swap O(1) de punteros tras el paso Fick Jacobi */
function swapMassBuffers() {
    const tmp = massRead;
    massRead = massWrite;
    massWrite = tmp;
}

/** Vacía masa/flujo y pone bordes sólidos */
function initGrid() {
    typeGrid.fill(AIR);
    massPing.fill(0);
    massPong.fill(0);
    massRead = massPing;
    massWrite = massPong;
    flowX.fill(0);
    flowY.fill(0);
    pressureGrid.fill(0);
    displayMassGrid.fill(0);
    displayFlowX.fill(0);
    displayFlowY.fill(0);

    const gs = GRID_SIZE;
    for (let i = 0; i < gs; i++) {
        typeGrid[i] = SOLID;
        typeGrid[i + (gs - 1) * gs] = SOLID;
        typeGrid[i * gs] = SOLID;
        typeGrid[(gs - 1) + i * gs] = SOLID;
    }
}

/** Masa total en massRead (sanity conservación) */
function totalMass() {
    let sum = 0;
    const m = massRead;
    const n = TOTAL_CELLS;
    for (let i = 0; i < n; i++) sum += m[i];
    return sum;
}

function isDeadMass(mass) {
    return (cfg.minFlow > 0) ? (mass <= cfg.minFlow) : (mass <= MASS_EPS);
}

function transferFloor() {
    return (cfg.minFlow > 0) ? cfg.minFlow : MASS_EPS;
}
