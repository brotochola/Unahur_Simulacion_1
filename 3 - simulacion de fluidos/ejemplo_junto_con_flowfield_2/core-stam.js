"use strict";

// Núcleo Stable Fluids (Stam) con grilla MAC: velocidad en caras (u verticales, v horizontales),
// presión en centros. Pipeline: Fuerzas → Advección V → Proyección (Jacobi-Poisson) → Advección de masa.
// Semi-Lagrangiano: movimiento continuo float (backtrace + bilineal), sin tope de v, sin túneles.
// La proyección hace el agua incompresible: div v = 0 → chorros y salpicadura reales.
// API duck-compatible con LAB_CORE (mismo harness, mismos escenarios).

const AIRE = 0,
  PIEDRA = 1,
  ARENA = 2,
  AGUA = 3,
  ACEITE = 4,
  LAVA = 5;

// Misma tabla que el núcleo CA (ids y colores coinciden; coeficientes CA no aplican acá).
const MATERIALES = [
  { id: AIRE, nombre: "Aire", color: [11, 13, 15], esVacio: true, esSolido: false },
  { id: PIEDRA, nombre: "Piedra", color: [74, 85, 96], esVacio: false, esSolido: true },
  { id: ARENA, nombre: "Arena", color: [217, 179, 108], esVacio: false, esSolido: false, reposo: 20 },
  { id: AGUA, nombre: "Agua", color: [79, 168, 255], esVacio: false, esSolido: false, reposo: 8 },
  { id: ACEITE, nombre: "Aceite", color: [169, 119, 46], esVacio: false, esSolido: false, reposo: 8 },
  { id: LAVA, nombre: "Lava", color: [220, 72, 24], esVacio: false, esSolido: false, reposo: 12 },
];

const esSolido = (idMat) => MATERIALES[idMat].esSolido;
const esVacio = (idMat) => MATERIALES[idMat].esVacio;
const esFluido = (idMat) =>
  !MATERIALES[idMat].esVacio && !MATERIALES[idMat].esSolido;
const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
const EPS_CANT = 1e-6;
const vacia = (c) => c <= EPS_CANT;

// Cantidad mínima por defecto para que una celda cuente como fluido (celda llena = reposo 8).
// Es knob global: config.epsFluido.
const EPS_FLUIDO_DEFAULT = 0.05;

// dt global de la simulación + umbral de celda fluida (knobs en config-global de la UI).
const config = { dt: 1, epsFluido: EPS_FLUIDO_DEFAULT };
const epsFluido = () => config.epsFluido ?? EPS_FLUIDO_DEFAULT;

// RNG con semilla: API compat con el harness (la física Stam no usa azar).
let estadoSemilla = 1;
function fijarSemilla(n) {
  config.semilla = n;
  estadoSemilla = (n == null ? 1 : n) | 0;
}
function rand() {
  if (config.semilla == null) return Math.random();
  estadoSemilla = (estadoSemilla + 0x6d2b79f5) | 0;
  let t = estadoSemilla;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Sample bilineal sobre grilla de nodos: arr[i + j*gw] vive en posición (i, j).
function sampleN(arr, gw, gh, px, py) {
  px = clamp(px, 0, gw - 1.001);
  py = clamp(py, 0, gh - 1.001);
  const x0 = Math.floor(px),
    y0 = Math.floor(py);
  const fx = px - x0,
    fy = py - y0;
  const i00 = y0 * gw + x0;
  const a = arr[i00] * (1 - fx) + arr[i00 + 1] * fx;
  const b = arr[i00 + gw] * (1 - fx) + arr[i00 + gw + 1] * fx;
  return a * (1 - fy) + b * fy;
}

class Mundo {
  constructor(ancho, alto) {
    this.ancho = ancho;
    this.alto = alto;
    const n = ancho * alto;
    this.material = new Uint8Array(n);
    this.cantidad = new Float32Array(n);
    this.cantidad2 = new Float32Array(n);
    this.p = new Float32Array(n);
    this.p2 = new Float32Array(n);
    this.div = new Float32Array(n);
    // MAC: u en caras verticales ((ancho+1) x alto), v en horizontales (ancho x (alto+1)).
    this.u = new Float32Array((ancho + 1) * alto);
    this.u2 = new Float32Array((ancho + 1) * alto);
    this.v = new Float32Array(ancho * (alto + 1));
    this.v2 = new Float32Array(ancho * (alto + 1));
    // v centrada por celda (métricas y overlay).
    this.vxC = new Float32Array(n);
    this.vyC = new Float32Array(n);
    this.masaObjetivo = 0;
    this.divergenciaMax = 0;
    // Dummies de chunks: este núcleo no duerme (API compat con la lectura de la UI).
    this.chunksX = 1;
    this.chunksY = 1;
    this.chunksActivos = new Uint8Array([1]);
  }

  idx(x, y) {
    return y * this.ancho + x;
  }
  idxU(x, y) {
    return y * (this.ancho + 1) + x;
  }
  idxV(x, y) {
    return y * this.ancho + x;
  }
  get vx() {
    return this.vxC;
  }
  get vy() {
    return this.vyC;
  }
  get stride() {
    return this.ancho;
  }

  marcarChunk() {}
  despertarTodos() {}
  despertarRadio() {}

  esFluidaCelda(x, y) {
    if (x < 0 || y < 0 || x >= this.ancho || y >= this.alto) return false;
    const i = this.idx(x, y);
    return this.material[i] === AGUA && this.cantidad[i] > epsFluido();
  }
  esSolidaCelda(x, y) {
    if (x < 0 || y < 0 || x >= this.ancho || y >= this.alto) return true;
    return this.material[this.idx(x, y)] === PIEDRA;
  }

  pintar(cx, cy, radio, idMaterial, intensidad) {
    const suma = Math.max(intensidad, EPS_CANT);
    for (let y = cy - radio; y <= cy + radio; y++) {
      for (let x = cx - radio; x <= cx + radio; x++) {
        if (x < 0 || x >= this.ancho || y < 0 || y >= this.alto) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > radio * radio) continue;
        const i = this.idx(x, y);
        if (esVacio(idMaterial)) {
          if (esFluido(this.material[i])) this.masaObjetivo -= this.cantidad[i];
          this.material[i] = AIRE;
          this.cantidad[i] = 0;
          this._ceroCaras(x, y);
          continue;
        }
        if (esSolido(idMaterial)) {
          if (esFluido(this.material[i])) this.masaObjetivo -= this.cantidad[i];
          this.material[i] = PIEDRA;
          this.cantidad[i] = 0;
          this._ceroCaras(x, y);
          continue;
        }
        const actual = this.material[i];
        if (actual !== AGUA) {
          this.material[i] = AGUA;
          this.cantidad[i] = suma;
          this.masaObjetivo += suma;
        } else {
          this.cantidad[i] += suma;
          this.masaObjetivo += suma;
        }
      }
    }
  }

  _ceroCaras(x, y) {
    this.u[this.idxU(x, y)] = 0;
    this.u[this.idxU(x + 1, y)] = 0;
    this.v[this.idxV(x, y)] = 0;
    this.v[this.idxV(x, y + 1)] = 0;
  }

  limpiar() {
    this.material.fill(AIRE);
    this.cantidad.fill(0);
    this.cantidad2.fill(0);
    this.p.fill(0);
    this.p2.fill(0);
    this.div.fill(0);
    this.u.fill(0);
    this.u2.fill(0);
    this.v.fill(0);
    this.v2.fill(0);
    this.vxC.fill(0);
    this.vyC.fill(0);
    this.masaObjetivo = 0;
    this.divergenciaMax = 0;
  }
}

// Cara contra sólido o fuera de la grilla: v = 0 (no atraviesa).
function aplicarFronteras(mundo) {
  const { ancho, alto, u, v } = mundo;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x <= ancho; x++) {
      if (mundo.esSolidaCelda(x - 1, y) || mundo.esSolidaCelda(x, y))
        u[mundo.idxU(x, y)] = 0;
    }
  }
  for (let y = 0; y <= alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (mundo.esSolidaCelda(x, y - 1) || mundo.esSolidaCelda(x, y))
        v[mundo.idxV(x, y)] = 0;
    }
  }
}

function actualizarCentrados(mundo) {
  const { ancho, alto, u, v, vxC, vyC } = mundo;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = mundo.idx(x, y);
      vxC[i] = (u[mundo.idxU(x, y)] + u[mundo.idxU(x + 1, y)]) / 2;
      vyC[i] = (v[mundo.idxV(x, y)] + v[mundo.idxV(x, y + 1)]) / 2;
    }
  }
}

function pasoFuerzas(mundo, cfg) {
  const g = (cfg.gravedad ?? 0.2) * config.dt;
  const { ancho, alto, v } = mundo;
  for (let y = 0; y <= alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const fluida =
        mundo.esFluidaCelda(x, y - 1) || mundo.esFluidaCelda(x, y);
      if (!fluida) continue;
      if (mundo.esSolidaCelda(x, y - 1) || mundo.esSolidaCelda(x, y)) continue;
      v[mundo.idxV(x, y)] += g;
    }
  }
}

function pasoAdveccionV(mundo, cfg) {
  const dt = config.dt;
  const decay = cfg.decay ?? 1;
  const { ancho, alto, u, v, u2, v2 } = mundo;
  // Caras u (verticales): posición física (x, y+0.5).
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x <= ancho; x++) {
      const i = mundo.idxU(x, y);
      const velU = u[i];
      const velV = sampleN(v, ancho, alto + 1, x - 0.5, y + 0.5);
      const px = x - velU * dt;
      const py = y + 0.5 - velV * dt;
      u2[i] = sampleN(u, ancho + 1, alto, px, py - 0.5);
    }
  }
  // Caras v (horizontales): posición física (x+0.5, y).
  for (let y = 0; y <= alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = mundo.idxV(x, y);
      const velU = sampleN(u, ancho + 1, alto, x + 0.5, y - 0.5);
      const velV = v[i];
      const px = x + 0.5 - velU * dt;
      const py = y - velV * dt;
      v2[i] = sampleN(v, ancho, alto + 1, px - 0.5, py);
    }
  }
  mundo.u.set(u2);
  mundo.v.set(v2);
  // Decay del flowfield (drag): v *= decay cada tick. 1 = sin amortiguación.
  if (decay < 1) {
    for (let i = 0; i < mundo.u.length; i++) mundo.u[i] *= decay;
    for (let i = 0; i < mundo.v.length; i++) mundo.v[i] *= decay;
  }
  aplicarFronteras(mundo);
}

// Proyección: resuelve ∇²p = div/dt con Jacobi y resta el gradiente.
// Superficie libre: p = 0 en aire. Sólido: Neumann (∂p/∂n = 0, espejo).
function pasoProyeccion(mundo, cfg) {
  const dt = config.dt;
  const iter = clamp(Math.round(cfg.iteraciones ?? 40), 1, 400);
  const warmStart = (cfg.warmStart ?? 1) > 0;
  const { ancho, alto, u, v, p, p2, div } = mundo;
  if (!warmStart) p.fill(0);

  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = mundo.idx(x, y);
      if (!mundo.esFluidaCelda(x, y)) {
        div[i] = 0;
        p[i] = 0;
        continue;
      }
      div[i] =
        u[mundo.idxU(x + 1, y)] -
        u[mundo.idxU(x, y)] +
        (v[mundo.idxV(x, y + 1)] - v[mundo.idxV(x, y)]);
    }
  }

  for (let it = 0; it < iter; it++) {
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const i = mundo.idx(x, y);
        if (!mundo.esFluidaCelda(x, y)) {
          p2[i] = 0;
          continue;
        }
        let sum = 0,
          nNoSolida = 0;
        // vecino fluido aporta su p; aire aporta 0 (p fija de superficie); sólido no cuenta
        if (!mundo.esSolidaCelda(x - 1, y)) {
          sum += mundo.esFluidaCelda(x - 1, y) ? p[mundo.idx(x - 1, y)] : 0;
          nNoSolida++;
        }
        if (!mundo.esSolidaCelda(x + 1, y)) {
          sum += mundo.esFluidaCelda(x + 1, y) ? p[mundo.idx(x + 1, y)] : 0;
          nNoSolida++;
        }
        if (!mundo.esSolidaCelda(x, y - 1)) {
          sum += mundo.esFluidaCelda(x, y - 1) ? p[mundo.idx(x, y - 1)] : 0;
          nNoSolida++;
        }
        if (!mundo.esSolidaCelda(x, y + 1)) {
          sum += mundo.esFluidaCelda(x, y + 1) ? p[mundo.idx(x, y + 1)] : 0;
          nNoSolida++;
        }
        if (nNoSolida === 0) {
          p2[i] = 0;
          continue;
        }
        p2[i] = (sum - div[i] / dt) / nNoSolida;
      }
    }
    p.set(p2);
  }

  // v* = v − dt·∇p
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x <= ancho; x++) {
      const i = mundo.idxU(x, y);
      if (mundo.esSolidaCelda(x - 1, y) || mundo.esSolidaCelda(x, y)) {
        u[i] = 0;
        continue;
      }
      const pL = mundo.esFluidaCelda(x - 1, y) ? p[mundo.idx(x - 1, y)] : 0;
      const pR = mundo.esFluidaCelda(x, y) ? p[mundo.idx(x, y)] : 0;
      u[i] -= dt * (pR - pL);
    }
  }
  for (let y = 0; y <= alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = mundo.idxV(x, y);
      if (mundo.esSolidaCelda(x, y - 1) || mundo.esSolidaCelda(x, y)) {
        v[i] = 0;
        continue;
      }
      const pT = mundo.esFluidaCelda(x, y - 1) ? p[mundo.idx(x, y - 1)] : 0;
      const pB = mundo.esFluidaCelda(x, y) ? p[mundo.idx(x, y)] : 0;
      v[i] -= dt * (pB - pT);
    }
  }

  // métrica: divergencia residual post-proyección
  let divMax = 0;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (!mundo.esFluidaCelda(x, y)) continue;
      const d = Math.abs(
        u[mundo.idxU(x + 1, y)] -
          u[mundo.idxU(x, y)] +
          (v[mundo.idxV(x, y + 1)] - v[mundo.idxV(x, y)]),
      );
      if (d > divMax) divMax = d;
    }
  }
  mundo.divergenciaMax = divMax;
}

function pasoAdveccionMasa(mundo, cfg) {
  const dt = config.dt;
  const { ancho, alto, cantidad, cantidad2, material, vxC, vyC } = mundo;
  actualizarCentrados(mundo);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = mundo.idx(x, y);
      if (material[i] === PIEDRA) {
        cantidad2[i] = 0;
        continue;
      }
      const px = x + 0.5 - vxC[i] * dt;
      const py = y + 0.5 - vyC[i] * dt;
      cantidad2[i] = sampleN(cantidad, ancho, alto, px - 0.5, py - 0.5);
    }
  }
  cantidad.set(cantidad2);
  // actualizar material + limpiar masa muerta
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = mundo.idx(x, y);
      if (material[i] === PIEDRA) continue;
      if (cantidad[i] > epsFluido()) material[i] = AGUA;
      else {
        material[i] = AIRE;
        cantidad[i] = 0;
      }
    }
  }
  // La semi-Lagrangiana no conserva exacto: renormalizar al objetivo (knob didáctico).
  if ((cfg.conservarMasa ?? 1) > 0 && mundo.masaObjetivo > epsFluido()) {
    let total = 0;
    for (let i = 0; i < ancho * alto; i++)
      if (material[i] === AGUA) total += cantidad[i];
    if (total > epsFluido()) {
      const f = mundo.masaObjetivo / total;
      for (let i = 0; i < ancho * alto; i++)
        if (material[i] === AGUA) cantidad[i] *= f;
    }
  }
}

const ordenPasos = [
  {
    id: "fuerzas",
    nombre: "Fuerzas (gravedad)",
    desc: "Suma gravedad a la velocidad vertical de las caras con fluido.",
    tooltip:
      "v += g·dt en caras horizontales adyacentes a fluido. Acá nace la aceleración de caída.",
    activo: true,
    fn: pasoFuerzas,
    cfg: { gravedad: 0.2 },
    knobs: [
      {
        key: "gravedad",
        corto: "g",
        label: "Gravedad",
        min: 0,
        max: 2,
        step: 0.01,
        tooltip: "Aceleración por tick² sobre v. 0 = ingravidez.",
      },
    ],
  },
  {
    id: "adveccionV",
    nombre: "Advección de velocidad",
    desc: "Cada cara pregunta de dónde vino su velocidad (backtrace + bilineal, float).",
    tooltip:
      "Semi-Lagrangiana: x − v·dt e interpolación bilineal. Estable para cualquier v; sin saltos enteros de celda.",
    activo: true,
    fn: pasoAdveccionV,
    cfg: { decay: 1 },
    knobs: [
      {
        key: "decay",
        corto: "decay",
        label: "Decay del flowfield",
        min: 0.9,
        max: 1,
        step: 0.001,
        tooltip:
          "v *= esto cada tick (drag). 1 = sin amortiguación. 0.98 frena el vaivén residual sin matar chorros.",
      },
    ],
    ayuda: "dt es global (panel Pipeline).",
  },
  {
    id: "proyeccion",
    nombre: "Proyección (presión global)",
    desc: "Resuelve la presión para que lo que entra en una celda sea igual a lo que sale.",
    tooltip:
      "Jacobi sobre ∇²p = div/dt, luego v −= dt·∇p. Agua incompresible: chorros y salpicadura reales. Superficie libre: p=0 en aire.",
    activo: true,
    fn: pasoProyeccion,
    cfg: { iteraciones: 40, warmStart: 1 },
    knobs: [
      {
        key: "iteraciones",
        corto: "iter",
        label: "Iteraciones Jacobi",
        min: 1,
        max: 200,
        step: 1,
        tooltip:
          "Más = presión más exacta (divergencia → 0) a más ms. Mirá divMax en el header.",
      },
      {
        key: "warmStart",
        corto: "warm",
        label: "Warm start de presión",
        min: 0,
        max: 1,
        step: 1,
        tooltip:
          "1 = Jacobi arranca desde la p del tick anterior (converge antes). 0 = desde cero cada tick.",
      },
    ],
  },
  {
    id: "adveccionMasa",
    nombre: "Advección de masa",
    desc: "El agua se mueve con el campo ya proyectado (mismo backtrace bilineal).",
    tooltip:
      "Semi-Lagrangiana sobre cantidad. No conserva exacto por difusión numérica: conservarMasa renormaliza al total pintado.",
    activo: true,
    fn: pasoAdveccionMasa,
    cfg: { conservarMasa: 1 },
    knobs: [
      {
        key: "conservarMasa",
        corto: "consM",
        label: "Conservar masa (renorm)",
        min: 0,
        max: 1,
        step: 1,
        tooltip:
          "1 = renormaliza la masa total cada tick. 0 = se ve la deriva de masa de la semi-Lagrangiana (medila con el harness).",
      },
    ],
  },
];

const CFG_PASOS_DEFAULT = ordenPasos.map((p) => ({ ...p.cfg }));
const MATERIALES_DEFAULT = MATERIALES.map((m) => ({ ...m }));

function restablecerPasos() {
  ordenPasos.forEach((p, n) => {
    p.cfg = { ...CFG_PASOS_DEFAULT[n] };
  });
}

function restablecerMateriales() {
  MATERIALES.forEach((m, n) => Object.assign(m, MATERIALES_DEFAULT[n]));
}

function exportarConfig() {
  return {
    version: 1,
    nucleo: "stam",
    config: { ...config },
    orden: ordenPasos.map((p) => p.id),
    pasos: ordenPasos.map((p) => ({ id: p.id, activo: p.activo, cfg: { ...p.cfg } })),
    materiales: MATERIALES.map((m) => ({ ...m })),
  };
}

function importarConfig(obj) {
  if (!obj || typeof obj !== "object") throw new Error("config inválida");
  if (obj.config && typeof obj.config === "object")
    Object.assign(config, obj.config);
  if (Array.isArray(obj.materiales)) {
    for (const mm of obj.materiales) {
      const mat = MATERIALES.find(
        (x) => x.id === mm.id || x.nombre === mm.nombre,
      );
      if (mat) Object.assign(mat, mm);
    }
  }
  if (Array.isArray(obj.pasos)) {
    for (const pp of obj.pasos) {
      const paso = ordenPasos.find((x) => x.id === pp.id);
      if (!paso) continue;
      if (pp.cfg) Object.assign(paso.cfg, pp.cfg);
      if (pp.activo !== undefined) paso.activo = !!pp.activo;
    }
  }
  if (Array.isArray(obj.orden)) {
    const nuevo = [];
    for (const id of obj.orden) {
      const paso = ordenPasos.find((x) => x.id === id);
      if (paso && !nuevo.includes(paso)) nuevo.push(paso);
    }
    for (const p of ordenPasos) if (!nuevo.includes(p)) nuevo.push(p);
    ordenPasos.length = 0;
    ordenPasos.push(...nuevo);
  }
}

function tick(mundo, tiempos) {
  const t0 = performance.now();
  for (const paso of ordenPasos) {
    if (!paso.activo) {
      if (tiempos) tiempos[paso.id] = 0;
      continue;
    }
    const a = performance.now();
    paso.fn(mundo, paso.cfg);
    if (tiempos) tiempos[paso.id] = performance.now() - a;
  }
  actualizarCentrados(mundo);
  return performance.now() - t0;
}

function medirMasa(mundo) {
  let total = 0;
  let vivas = 0;
  const porMat = new Float64Array(MATERIALES.length);
  for (let y = 0; y < mundo.alto; y++) {
    for (let x = 0; x < mundo.ancho; x++) {
      const i = mundo.idx(x, y);
      const mat = mundo.material[i];
      if (!esFluido(mat) || vacia(mundo.cantidad[i])) continue;
      total += mundo.cantidad[i];
      porMat[mat] += mundo.cantidad[i];
      vivas++;
    }
  }
  return { total, porMat, vivas };
}

const LAB_STAM = {
  AIRE,
  PIEDRA,
  ARENA,
  AGUA,
  ACEITE,
  LAVA,
  MATERIALES,
  esSolido,
  esVacio,
  esFluido,
  clamp,
  vacia,
  EPS_FLUIDO_DEFAULT,
  config,
  fijarSemilla,
  rand,
  Mundo,
  ordenPasos,
  restablecerPasos,
  restablecerMateriales,
  exportarConfig,
  importarConfig,
  tick,
  medirMasa,
  pasoFuerzas,
  pasoAdveccionV,
  pasoProyeccion,
  pasoAdveccionMasa,
};

if (typeof module !== "undefined" && module.exports) module.exports = LAB_STAM;
else globalThis.LAB_STAM = LAB_STAM;
