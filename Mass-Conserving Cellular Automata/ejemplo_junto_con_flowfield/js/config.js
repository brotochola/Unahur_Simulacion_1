/**
 * config.js — Constantes, tipos de celda y knobs por defecto.
 * Todo mutable vive en `cfg` / flags para que UI y física lean el mismo objeto.
 */
"use strict";

const AIR = 0;
const SOLID = 1;
const WATER = 2;

/** Epsilon numérico para denormals / divisiones */
const MASS_EPS = 1e-12;

/** Substeps quietos antes de dormir un chunk sin actividad */
const QUIET_FRAMES = 3;

/** Vecindad de Moore (8 dirs). Y+ = abajo en pantalla. */
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [1, 1, 0, -1, -1, -1, 0, 1];
const DIST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];
const NORM_DX = new Float32Array(8);
const NORM_DY = new Float32Array(8);
const INV_DIST = new Float32Array(8);
for (let i = 0; i < 8; i++) {
  NORM_DX[i] = DX[i] / DIST[i];
  NORM_DY[i] = DY[i] / DIST[i];
  INV_DIST[i] = 1 / DIST[i];
}

/** Scratch reutilizado: outflows deseados por dirección (sin alloc en hot loop) */
const outflows = new Float32Array(8);

/** Parámetros físicos / UI (mutables) */
const cfg = {
  restCapacity: 1.0, // N_reposo por celda
  diffusion: 0.21, // D de Fick
  gravity: 0.5, // partículas max falling-sand / substep
  lerp: 0.5, // alpha inercia flowfield
  flowInfluence: 0.5, // peso de V en J de Fick
  minFlow: 0.002, // umbral masa muerta / transfer mínimo
  flowSnapSq: 0.0001, // si |V|^2 < esto → V = 0
  flowMaxMag: 70.0, // tope |V| del flowfield (clamp post-lerp)
  substeps: 5,
  brushRadius: 4,
  brushAmount: 10.0, // partículas que suma el pincel de agua por celda/frame
  displayLerp: 0.9,
  flowDebugScale: 0.25,
  velColorScale: 4.0,
  pressureRedAt: 1.0, // masa absoluta que satura a rojo (auto = max celda)
  foamVelScale: 0.0, // sensibilidad espuma por |V| en modo agua
  nbMassRef: 23.0, // waterNb: escala masa→oscuridad (mass/(rest*ref))
  nbFoamThresh: 1.0, // waterNb: intensidad espuma por contacto AIR
  nbVelWhite: 34.0, // waterNb: mag² media (9 celdas) que satura a espuma
  arrowStep: 1,
  gridStep: 1,
  flowAvgEvery: 1, // 0=off; N=promedio espacial cada N substeps
  flowAvgBlend: 0.06, // alpha hacia promedio vecinos (0=retiene, 1=full avg)
};

/** Flags de runtime */
const flags = {
  useChunkCulling: true,
  useTemporalSmooth: false,
  showFlowfield: true,
  showGrid: false,
  showChunks: false,
  isPaused: true,
  renderMode: "waterNb", // mass | velocity | pressure | compress | water | waterNb
  /** 'webgl' | 'imagedata' — ambos con dirty chunks */
  rendererBackend: "webgl",
  /** 'gpu' | 'cpu' — física en texturas WebGL2 o TypedArrays */
  simBackend: "gpu",
  flowAvgWaterToAir: false, // promedio sangra agua → aire
  flowAvgAirToWater: false, // promedio incluye aire en celdas agua
};

/** Estado de reproducción / debug */
const runtime = {
  totalSubstepsExecuted: 0,
  currentSubstepIndex: 0,
  mouseX: -1,
  mouseY: -1,
  isMouseDown: false,
  currentTool: WATER,
  maxCellMass: 0, // max particulas en cualquier celda WATER (por frame)
};
