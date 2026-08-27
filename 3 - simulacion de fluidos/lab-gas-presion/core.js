"use strict";

// Núcleo de simulación puro: sin DOM. Corre igual en browser (globalThis.LAB_CORE) y en Node (module.exports).

const VMAX = 7;
const PAD = VMAX;
const CHUNK = 16;
const EPS_CANT = 1e-6;
const VECINOS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const SQRT2 = Math.SQRT2;
const MOORE = [
  [0, 1, 1],
  [1, 1, SQRT2],
  [1, 0, 1],
  [1, -1, SQRT2],
  [0, -1, 1],
  [-1, -1, SQRT2],
  [-1, 0, 1],
  [-1, 1, SQRT2],
];

const AIRE = 0,
  PIEDRA = 1,
  ARENA = 2,
  AGUA = 3,
  ACEITE = 4,
  LAVA = 5;

const MATERIALES = [
  {
    id: AIRE,
    nombre: "Aire",
    color: [11, 13, 15],
    esVacio: true,
    esSolido: false,
  },
  {
    id: PIEDRA,
    nombre: "Piedra",
    color: [74, 85, 96],
    esVacio: false,
    esSolido: true,
    restitucion: 0.35,
    friccion: 0.4,
  },
  {
    id: ARENA,
    nombre: "Arena",
    color: [217, 179, 108],
    esVacio: false,
    esSolido: false,
    gravedad: 1.0,
    difusion: 0.05,
    viscosidad: 0.05,
    densidad: 1.6,
    reposo: 20,
    pisoGravedad: 0,
  },
  {
    id: AGUA,
    nombre: "Agua",
    color: [79, 168, 255],
    esVacio: false,
    esSolido: false,
    gravedad: 1.0,
    difusion: 0.21,
    viscosidad: 0.4,
    densidad: 1.0,
    reposo: 8,
    pisoGravedad: 8,
  },
  {
    id: ACEITE,
    nombre: "Aceite",
    color: [169, 119, 46],
    esVacio: false,
    esSolido: false,
    gravedad: 0.6,
    difusion: 0.35,
    viscosidad: 0.55,
    densidad: 0.75,
    reposo: 8,
    pisoGravedad: 0,
  },
  {
    id: LAVA,
    nombre: "Lava",
    color: [220, 72, 24],
    esVacio: false,
    esSolido: false,
    gravedad: 0.85,
    difusion: 0.25,
    viscosidad: 0.7,
    densidad: 2.4,
    reposo: 12,
    pisoGravedad: 0,
  },
];

const esSolido = (idMat) => MATERIALES[idMat].esSolido;
const esVacio = (idMat) => MATERIALES[idMat].esVacio;
const esFluido = (idMat) =>
  !MATERIALES[idMat].esVacio && !MATERIALES[idMat].esSolido;
const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
const clavePar = (a, b) => (a < b ? (a << 8) | b : (b << 8) | a);
const vacia = (c) => c <= EPS_CANT;

// Config global del núcleo (la UI la pisa con sus sliders).
const config = {
  vMax: VMAX,
  umbralCampo: 0.05,
};

const topeVelocidad = () => config.vMax ?? VMAX;

// P = max(0, n - reposo). Aire y sólidos: 0. Debajo del reposo no emite.
function presionDe(mat, cant) {
  if (!esFluido(mat)) return 0;
  return Math.max(0, cant - MATERIALES[mat].reposo);
}

const REACCIONES = new Map();
REACCIONES.set(clavePar(LAVA, AGUA), (mundo, i, j, matI, matJ) => {
  const iAgua = matI === AGUA ? i : j;
  mundo.material[iAgua] = PIEDRA;
  mundo.cantidad[iAgua] = 1;
  mundo.vx[iAgua] = 0;
  mundo.vy[iAgua] = 0;
});

function generarPasosDDA(dx, dy) {
  const distancia = Math.max(Math.abs(dx), Math.abs(dy));
  if (distancia === 0) return [];
  const pasos = [];
  for (let paso = 1; paso <= distancia; paso++) {
    const t = paso / distancia;
    const px = Math.round(dx * t);
    const py = Math.round(dy * t);
    const anterior = pasos[pasos.length - 1];
    if (!anterior || anterior.dx !== px || anterior.dy !== py)
      pasos.push({ dx: px, dy: py });
  }
  return pasos;
}

const LUT_TRAYECTORIAS = new Map();
for (let vx = -VMAX; vx <= VMAX; vx++) {
  for (let vy = -VMAX; vy <= VMAX; vy++) {
    LUT_TRAYECTORIAS.set(vx * 32 + vy, generarPasosDDA(vx, vy));
  }
}

function obtenerTrayectoria(vx, vy) {
  const ivx = clamp(Math.round(vx), -VMAX, VMAX);
  const ivy = clamp(Math.round(vy), -VMAX, VMAX);
  return LUT_TRAYECTORIAS.get(ivx * 32 + ivy);
}

class Mundo {
  constructor(ancho, alto) {
    this.ancho = ancho;
    this.alto = alto;
    this.stride = ancho + PAD * 2;
    this.altoTotal = alto + PAD * 2;
    const total = this.stride * this.altoTotal;

    this.materialA = new Uint8Array(total);
    this.cantidadA = new Float32Array(total);
    this.vxA = new Float32Array(total);
    this.vyA = new Float32Array(total);

    this.materialB = new Uint8Array(total);
    this.cantidadB = new Float32Array(total);
    this.vxB = new Float32Array(total);
    this.vyB = new Float32Array(total);

    this.dadoX = new Float32Array(total);
    this.dadoY = new Float32Array(total);
    this.recibidoX = new Float32Array(total);
    this.recibidoY = new Float32Array(total);
    this.blurVX = new Float32Array(total);
    this.blurVY = new Float32Array(total);

    this.chunksX = Math.ceil(ancho / CHUNK);
    this.chunksY = Math.ceil(alto / CHUNK);
    this.chunksActivos = new Uint8Array(this.chunksX * this.chunksY);
    this.chunksProcesar = new Uint8Array(this.chunksX * this.chunksY);
    this.chunksActivosSig = new Uint8Array(this.chunksX * this.chunksY);

    this.usarA = true;
    this._sellarBordes(this.materialA);
    this._sellarBordes(this.materialB);
    this.despertarTodos();
  }

  _sellarBordes(materialArr) {
    for (let y = -PAD; y < this.alto + PAD; y++) {
      for (let x = -PAD; x < this.ancho + PAD; x++) {
        const dentro = x >= 0 && x < this.ancho && y >= 0 && y < this.alto;
        if (!dentro) materialArr[this.idx(x, y)] = PIEDRA;
      }
    }
  }

  idx(x, y) {
    return (y + PAD) * this.stride + (x + PAD);
  }
  intercambiar() {
    this.usarA = !this.usarA;
  }

  get material() {
    return this.usarA ? this.materialA : this.materialB;
  }
  get cantidad() {
    return this.usarA ? this.cantidadA : this.cantidadB;
  }
  get vx() {
    return this.usarA ? this.vxA : this.vxB;
  }
  get vy() {
    return this.usarA ? this.vyA : this.vyB;
  }
  get materialSig() {
    return this.usarA ? this.materialB : this.materialA;
  }
  get cantidadSig() {
    return this.usarA ? this.cantidadB : this.cantidadA;
  }
  get vxSig() {
    return this.usarA ? this.vxB : this.vxA;
  }
  get vySig() {
    return this.usarA ? this.vyB : this.vyA;
  }

  chunkId(x, y) {
    return Math.floor(y / CHUNK) * this.chunksX + Math.floor(x / CHUNK);
  }

  marcarChunk(x, y) {
    if (x < 0 || y < 0 || x >= this.ancho || y >= this.alto) return;
    this.chunksActivosSig[this.chunkId(x, y)] = 1;
  }

  despertarTodos() {
    this.chunksActivos.fill(1);
    this.chunksProcesar.fill(1);
    this.chunksActivosSig.fill(1);
  }

  despertarRadio(cx, cy, radio) {
    for (let y = cy - radio; y <= cy + radio; y++) {
      for (let x = cx - radio; x <= cx + radio; x++) {
        this.marcarChunk(x, y);
        if (x >= 0 && y >= 0 && x < this.ancho && y < this.alto) {
          this.chunksActivos[this.chunkId(x, y)] = 1;
        }
      }
    }
  }

  expandirChunks() {
    this.chunksProcesar.fill(0);
    for (let cy = 0; cy < this.chunksY; cy++) {
      for (let cx = 0; cx < this.chunksX; cx++) {
        if (!this.chunksActivos[cy * this.chunksX + cx]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx,
              ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= this.chunksX || ny >= this.chunksY)
              continue;
            this.chunksProcesar[ny * this.chunksX + nx] = 1;
          }
        }
      }
    }
    this.chunksActivosSig.fill(0);
  }

  recorrerCeldas(fn, opciones) {
    const alternarFilas = !!(opciones && opciones.alternarFilas);
    const desdeAbajo = !!(opciones && opciones.desdeAbajo);
    const cyInicio = desdeAbajo ? this.chunksY - 1 : 0;
    const cyFin = desdeAbajo ? -1 : this.chunksY;
    const cyPaso = desdeAbajo ? -1 : 1;
    for (let cy = cyInicio; cy !== cyFin; cy += cyPaso) {
      for (let cx = 0; cx < this.chunksX; cx++) {
        if (!this.chunksProcesar[cy * this.chunksX + cx]) continue;
        const x0 = cx * CHUNK;
        const y0 = cy * CHUNK;
        const x1 = Math.min(this.ancho, x0 + CHUNK);
        const y1 = Math.min(this.alto, y0 + CHUNK);
        const yInicio = desdeAbajo ? y1 - 1 : y0;
        const yFin = desdeAbajo ? y0 - 1 : y1;
        const yPaso = desdeAbajo ? -1 : 1;
        for (let y = yInicio; y !== yFin; y += yPaso) {
          const deIzquierda = !alternarFilas || y % 2 === 0;
          const anchoFila = x1 - x0;
          for (let paso = 0; paso < anchoFila; paso++) {
            const x = deIzquierda ? x0 + paso : x1 - 1 - paso;
            fn(x, y, this.idx(x, y));
          }
        }
      }
    }
  }

  pintar(cx, cy, radio, idMaterial, intensidad) {
    const suma = Math.max(intensidad, EPS_CANT);
    for (let y = cy - radio; y <= cy + radio; y++) {
      for (let x = cx - radio; x <= cx + radio; x++) {
        if (x < 0 || x >= this.ancho || y < 0 || y >= this.alto) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > radio * radio) continue;
        const i = this.idx(x, y);
        if (esVacio(idMaterial)) {
          this.material[i] = AIRE;
          this.cantidad[i] = 0;
          this.vx[i] = 0;
          this.vy[i] = 0;
          continue;
        }
        if (esSolido(idMaterial)) {
          this.material[i] = idMaterial;
          this.cantidad[i] = 1;
          this.vx[i] = 0;
          this.vy[i] = 0;
          continue;
        }
        const actual = this.material[i];
        if (actual === AIRE) {
          this.material[i] = idMaterial;
          this.cantidad[i] = suma;
          this.vx[i] = 0;
          this.vy[i] = 0;
        } else if (actual === idMaterial) {
          this.cantidad[i] += suma;
        }
      }
    }
    this.despertarRadio(cx, cy, radio + CHUNK);
  }

  pintarVector(cx, cy, radio, vx0, vy0) {
    const vmax = topeVelocidad();
    const nvx = clamp(vx0, -vmax, vmax);
    const nvy = clamp(vy0, -vmax, vmax);
    for (let y = cy - radio; y <= cy + radio; y++) {
      for (let x = cx - radio; x <= cx + radio; x++) {
        if (x < 0 || x >= this.ancho || y < 0 || y >= this.alto) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > radio * radio) continue;
        const i = this.idx(x, y);
        if (!esFluido(this.material[i]) || vacia(this.cantidad[i])) continue;
        this.vx[i] = nvx;
        this.vy[i] = nvy;
      }
    }
    this.despertarRadio(cx, cy, radio + CHUNK);
  }

  limpiar() {
    for (const matArr of [this.materialA, this.materialB]) {
      matArr.fill(AIRE);
      this._sellarBordes(matArr);
    }
    this.cantidadA.fill(0);
    this.cantidadB.fill(0);
    this.vxA.fill(0);
    this.vyA.fill(0);
    this.vxB.fill(0);
    this.vyB.fill(0);
    this.dadoX.fill(0);
    this.dadoY.fill(0);
    this.recibidoX.fill(0);
    this.recibidoY.fill(0);
    this.despertarTodos();
  }
}

// Sin techo: aire o mismo material siempre aceptan. Solo el sólido bloquea.
function espacioLibre(materialArr, idx, mat) {
  const m = materialArr[idx];
  if (esSolido(m)) return 0;
  if (m === AIRE || m === mat) return Infinity;
  return 0;
}

function rebotar(vx, vy, nx, ny, rest, fric) {
  const vn = vx * nx + vy * ny;
  const vnPost = vn < 0 ? -vn * rest : vn;
  const vtx = vx - vn * nx;
  const vty = vy - vn * ny;
  const k = 1 - fric;
  return {
    vx: clamp(vnPost * nx + vtx * k, -topeVelocidad(), topeVelocidad()),
    vy: clamp(vnPost * ny + vty * k, -topeVelocidad(), topeVelocidad()),
  };
}

function pasoGravedad(mundo, cfg) {
  const { material, cantidad, vx, vy, stride, dadoY, recibidoY } = mundo;
  const flujo = cfg.flujo ?? 0;
  const impulso = cfg.impulso ?? 0;

  if (flujo > 0) {
    for (let y = mundo.alto - 1; y >= 0; y--) {
      for (let x = 0; x < mundo.ancho; x++) {
        const i = mundo.idx(x, y);
        const mat = material[i];
        if (!esFluido(mat) || vacia(cantidad[i])) continue;
        if (y >= mundo.alto - 1) continue;
        const j = i + stride;
        const matAbajo = material[j];
        if (matAbajo !== AIRE && matAbajo !== mat) continue;
        const techo =
          matAbajo === AIRE
            ? cantidad[i]
            : Math.max(0, cantidad[i] - (MATERIALES[mat].pisoGravedad ?? 0));
        const T = Math.min(flujo, techo);
        if (T <= EPS_CANT) continue;
        const ovx = vx[i];
        const ovy = vy[i];
        cantidad[i] -= T;
        if (vacia(cantidad[i])) {
          material[i] = AIRE;
          cantidad[i] = 0;
          vx[i] = 0;
          vy[i] = 0;
        }
        if (matAbajo === AIRE) {
          material[j] = mat;
          cantidad[j] = T;
          vx[j] = ovx;
          vy[j] = ovy;
        } else {
          cantidad[j] += T;
        }
        dadoY[i] += T;
        recibidoY[j] += T;
        mundo.marcarChunk(x, y);
        mundo.marcarChunk(x, y + 1);
      }
    }
  }

  if (impulso > 0) {
    for (let y = 0; y < mundo.alto; y++) {
      for (let x = 0; x < mundo.ancho; x++) {
        const i = mundo.idx(x, y);
        const mat = material[i];
        if (!esFluido(mat) || vacia(cantidad[i])) continue;
        if (material[i + stride] !== AIRE) continue;
        const g = MATERIALES[mat].gravedad * impulso;
        vy[i] = clamp(vy[i] + g, -topeVelocidad(), topeVelocidad());
        mundo.marcarChunk(x, y);
      }
    }
  }
}

// 0 = lineal, 1 = log1p. Evita que 1e6 partículas sature vMax de un saque.
function comprimirMag(mag, k) {
  if (mag <= 0) return 0;
  const k0 = clamp(k, 0, 1);
  return mag * (1 - k0) + Math.log1p(mag) * k0;
}

function aplicarCompresion(x, y, k) {
  const mag = Math.hypot(x, y);
  if (mag < EPS_CANT) return { x: 0, y: 0 };
  const m2 = comprimirMag(mag, k);
  return { x: (x / mag) * m2, y: (y / mag) * m2 };
}

// Fick Jacobi: lee cantidad actual, escala si sumJ > exceso, escribe sig. Anota dado/recibido.
function pasoDifusionFick(mundo, cfg) {
  mundo.materialSig.set(mundo.material);
  mundo.cantidadSig.set(mundo.cantidad);
  mundo.vxSig.set(mundo.vx);
  mundo.vySig.set(mundo.vy);

  const {
    material,
    cantidad,
    stride,
    materialSig,
    cantidadSig,
    vxSig,
    vySig,
    dadoX,
    dadoY,
    recibidoX,
    recibidoY,
  } = mundo;
  const tasa = cfg.tasa ?? 1;
  const mult = cfg.multiplicadorPresion ?? 1;
  const flujoMax = cfg.flujoMax ?? Infinity;

  mundo.recorrerCeldas((x, y, i) => {
    const mat = material[i];
    if (!esFluido(mat) || vacia(cantidad[i])) return;
    const Ci = presionDe(mat, cantidad[i]);
    if (Ci <= EPS_CANT) return;
    const coef = MATERIALES[mat].difusion * tasa * mult;
    if (coef <= 0) return;

    const dests = [];
    let sumJ = 0;
    for (const [dx, dy, dist] of MOORE) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= mundo.ancho || ny >= mundo.alto) continue;
      const j = i + dy * stride + dx;
      const matB = material[j];
      if (esSolido(matB)) continue;
      if (matB !== AIRE && matB !== mat) continue;
      if (espacioLibre(materialSig, j, mat) <= 0) continue;
      const pB = presionDe(matB, cantidad[j]);
      const ndx = dx / dist,
        ndy = dy / dist;
      let t = 0;
      const dP = Ci - pB;
      if (dP > 0) t = (dP * coef) / dist;
      if (t <= EPS_CANT) continue;
      t = Math.min(t, flujoMax);
      dests.push({ j, nx, ny, ndx, ndy, t });
      sumJ += t;
    }
    if (sumJ <= EPS_CANT) return;

    const exceso = Math.max(0, cantidad[i] - MATERIALES[mat].reposo);
    const scale = sumJ > exceso ? exceso / sumJ : 1;
    let sacado = 0;
    for (const d of dests) {
      const t = d.t * scale;
      if (t <= EPS_CANT) continue;
      sacado += t;
      materialSig[d.j] = mat;
      cantidadSig[d.j] += t;
      dadoX[i] += d.ndx * t;
      dadoY[i] += d.ndy * t;
      recibidoX[d.j] += d.ndx * t;
      recibidoY[d.j] += d.ndy * t;
      mundo.marcarChunk(d.nx, d.ny);
    }
    if (sacado <= EPS_CANT) return;
    cantidadSig[i] -= sacado;
    if (vacia(cantidadSig[i])) {
      materialSig[i] = AIRE;
      cantidadSig[i] = 0;
      vxSig[i] = 0;
      vySig[i] = 0;
    }
    mundo.marcarChunk(x, y);
  });

  mundo.intercambiar();
}

function pasoGenerarVector(mundo, cfg) {
  const {
    material,
    cantidad,
    vx,
    vy,
    stride,
    dadoX,
    dadoY,
    recibidoX,
    recibidoY,
    blurVX,
    blurVY,
  } = mundo;
  const eps = cfg.epsilon ?? 0.15;
  const infFick = cfg.infFick ?? 0;
  const infDadas = cfg.infDadas ?? 0;
  const infRec = cfg.infRecibidas ?? 0;
  const comp = cfg.compresionFlujo ?? 0;
  const mixKnob = cfg.promedioMix ?? 0;
  const radio = clamp(Math.round(cfg.radioBlur ?? 2), 1, 3);
  const inercia = cfg.inercia ?? 0.99;
  const vmax = config.vMax ?? VMAX;

  mundo.recorrerCeldas((x, y, i) => {
    const mat = material[i];
    if (!esFluido(mat) || vacia(cantidad[i])) {
      vx[i] = 0;
      vy[i] = 0;
      blurVX[i] = 0;
      blurVY[i] = 0;
      return;
    }
    let nvx = vx[i] * inercia;
    let nvy = vy[i] * inercia;

    const p0 = presionDe(mat, cantidad[i]);
    let gx = 0,
      gy = 0;
    for (const [dx, dy, dist] of MOORE) {
      const j = i + dy * stride + dx;
      const matV = material[j];
      const pV =
        matV === AIRE || matV === mat ? presionDe(matV, cantidad[j]) : p0;
      gx += ((p0 - pV) * dx) / dist;
      gy += ((p0 - pV) * dy) / dist;
    }
    const g = aplicarCompresion(gx, gy, comp);
    nvx += g.x * infFick;
    nvy += g.y * infFick;

    const d = aplicarCompresion(dadoX[i], dadoY[i], comp);
    nvx += d.x * infDadas;
    nvy += d.y * infDadas;

    const r = aplicarCompresion(recibidoX[i], recibidoY[i], comp);
    nvx += r.x * infRec;
    nvy += r.y * infRec;

    blurVX[i] = nvx;
    blurVY[i] = nvy;
  });

  mundo.recorrerCeldas((x, y, i) => {
    const mat = material[i];
    if (!esFluido(mat) || vacia(cantidad[i])) return;
    let sumaX = blurVX[i],
      sumaY = blurVY[i],
      cuenta = 1;
    for (let dy = -radio; dy <= radio; dy++) {
      for (let dx = -radio; dx <= radio; dx++) {
        if (dx === 0 && dy === 0) continue;
        const v = i + dy * stride + dx;
        if (material[v] === mat && !vacia(cantidad[v])) {
          sumaX += blurVX[v];
          sumaY += blurVY[v];
          cuenta++;
        }
      }
    }
    const mix = mixKnob * MATERIALES[mat].viscosidad;
    let nvx = blurVX[i] + (sumaX / cuenta - blurVX[i]) * mix;
    let nvy = blurVY[i] + (sumaY / cuenta - blurVY[i]) * mix;
    if (Math.abs(nvx) < eps) nvx = 0;
    if (Math.abs(nvy) < eps) nvy = 0;
    vx[i] = clamp(nvx, -vmax, vmax);
    vy[i] = clamp(nvy, -vmax, vmax);
  });
}

function depositar(
  materialSig,
  cantidadSig,
  vxSig,
  vySig,
  dest,
  mat,
  transfer,
  vxN,
  vyN,
) {
  const c0 = materialSig[dest] === mat ? cantidadSig[dest] : 0;
  const c1 = transfer;
  const total = c0 + c1;
  materialSig[dest] = mat;
  cantidadSig[dest] = total;
  if (total > 0) {
    vxSig[dest] = (vxSig[dest] * c0 + vxN * c1) / total;
    vySig[dest] = (vySig[dest] * c0 + vyN * c1) / total;
  }
}

function vaciarOrigen(materialSig, cantidadSig, vxSig, vySig, i, transfer) {
  const resto = cantidadSig[i] - transfer;
  if (vacia(resto)) {
    materialSig[i] = AIRE;
    cantidadSig[i] = 0;
    vxSig[i] = 0;
    vySig[i] = 0;
  } else {
    cantidadSig[i] = resto;
  }
}

function salpicar(mundo, i, x, y, mat, cant, nx, ny, impact, cfg, vxN, vyN) {
  const { materialSig, cantidadSig, vxSig, vySig, stride } = mundo;
  const vmax = topeVelocidad();
  const splashFraccion = cfg.splashFraccion ?? 0.5;
  const splashNormal = cfg.splashNormal ?? 0.4;
  const splashRuido = cfg.splashRuido ?? 1.2;
  const splashHerencia = cfg.splashHerencia ?? 0.2;
  const fraccion = Math.min(
    splashFraccion,
    (impact - cfg.umbralSplash) / vmax,
  );
  const aRepartir = Math.min(cant, Math.max(EPS_CANT, cant * fraccion));
  const huecos = [];
  for (const [dx, dy] of VECINOS) {
    const j = i + dy * stride + dx;
    if (espacioLibre(materialSig, j, mat) > 0) huecos.push({ j, dx, dy });
  }
  if (huecos.length === 0) return 0;
  let dado = 0;
  const base = aRepartir / huecos.length;
  for (const h of huecos) {
    const share = Math.min(base, aRepartir - dado);
    if (share <= EPS_CANT) continue;
    const rvx = clamp(
      nx * impact * splashNormal +
        (Math.random() - 0.5) * splashRuido +
        vxN * splashHerencia,
      -vmax,
      vmax,
    );
    const rvy = clamp(
      ny * impact * splashNormal +
        (Math.random() - 0.5) * splashRuido +
        vyN * splashHerencia,
      -vmax,
      vmax,
    );
    depositar(
      materialSig,
      cantidadSig,
      vxSig,
      vySig,
      h.j,
      mat,
      share,
      rvx,
      rvy,
    );
    mundo.marcarChunk(x + h.dx, y + h.dy);
    dado += share;
  }
  return dado;
}

function pasoMovimiento(mundo, cfg) {
  if ((cfg.caudal ?? 0) <= 0) return;
  mundo.materialSig.set(mundo.material);
  mundo.cantidadSig.set(mundo.cantidad);
  mundo.vxSig.set(mundo.vx);
  mundo.vySig.set(mundo.vy);

  const {
    material,
    cantidad,
    vx,
    vy,
    stride,
    materialSig,
    cantidadSig,
    vxSig,
    vySig,
  } = mundo;
  const vmax = topeVelocidad();
  const fraccionCamino = cfg.fraccionCamino ?? 0;
  const impulsoCamino = cfg.impulsoCamino ?? 0;

  mundo.recorrerCeldas(
    (x, y, i) => {
      const mat = material[i];
      if (!esFluido(mat)) return;
      const cant = cantidad[i];
      if (vacia(cant)) return;
      const vx0 = vx[i],
        vy0 = vy[i];
      if (vx0 === 0 && vy0 === 0) return;

      const ivx = clamp(Math.round(vx0), -vmax, vmax);
      const ivy = clamp(Math.round(vy0), -vmax, vmax);
      if (ivx === 0 && ivy === 0) return;

      const trayectoria = obtenerTrayectoria(vx0, vy0);
      const camino = [];
      let chocoSolido = false;
      let nx = 0,
        ny = 0;
      let prevDx = 0,
        prevDy = 0;
      let matSolido = PIEDRA;

      for (const p of trayectoria) {
        const candidato = i + p.dy * stride + p.dx;
        const stepDx = p.dx - prevDx;
        const stepDy = p.dy - prevDy;
        prevDx = p.dx;
        prevDy = p.dy;

        if (esSolido(material[candidato])) {
          chocoSolido = true;
          matSolido = material[candidato];
          if (Math.abs(stepDx) >= Math.abs(stepDy) && stepDx !== 0) {
            nx = -Math.sign(stepDx);
            ny = 0;
          } else if (stepDy !== 0) {
            nx = 0;
            ny = -Math.sign(stepDy);
          } else {
            nx = -Math.sign(vx0) || 0;
            ny = -Math.sign(vy0) || -1;
          }
          break;
        }

        camino.push(candidato);
      }

      const mag = Math.hypot(vx0, vy0);
      const caudal = Math.max(EPS_CANT, mag * cfg.caudal);
      const T = Math.min(cant, caudal);

      let vxN = vx0,
        vyN = vy0;
      if (chocoSolido) {
        const rest = MATERIALES[matSolido].restitucion ?? 0.3;
        const fric = MATERIALES[matSolido].friccion ?? 0.4;
        const reb = rebotar(vx0, vy0, nx, ny, rest, fric);
        vxN = reb.vx;
        vyN = reb.vy;
      }

      if (camino.length === 0 || T <= EPS_CANT) {
        const impact = Math.abs(vx0 * nx + vy0 * ny);
        let transferido = 0;
        if (chocoSolido && impact > cfg.umbralSplash) {
          transferido = salpicar(
            mundo,
            i,
            x,
            y,
            mat,
            cant,
            nx,
            ny,
            impact,
            cfg,
            vxN,
            vyN,
          );
          if (transferido > 0)
            vaciarOrigen(
              materialSig,
              cantidadSig,
              vxSig,
              vySig,
              i,
              transferido,
            );
        }
        if (materialSig[i] === mat) {
          vxSig[i] = vxN;
          vySig[i] = vyN;
        }
        mundo.marcarChunk(x, y);
        return;
      }

      const destinos = camino.filter(
        (dest) => espacioLibre(materialSig, dest, mat) > 0,
      );
      if (destinos.length === 0) {
        const impact = Math.abs(vx0 * nx + vy0 * ny);
        let transferido = 0;
        if (chocoSolido && impact > cfg.umbralSplash) {
          transferido = salpicar(
            mundo,
            i,
            x,
            y,
            mat,
            cant,
            nx,
            ny,
            impact,
            cfg,
            vxN,
            vyN,
          );
          if (transferido > 0)
            vaciarOrigen(
              materialSig,
              cantidadSig,
              vxSig,
              vySig,
              i,
              transferido,
            );
        }
        if (materialSig[i] === mat) {
          vxSig[i] = vxN;
          vySig[i] = vyN;
        }
        mundo.marcarChunk(x, y);
        return;
      }

      const dirx = vx0 / mag;
      const diry = vy0 / mag;
      let restante = T;
      let depositado = 0;
      let ultimo = i;

      for (let n = 0; n < destinos.length; n++) {
        const dest = destinos[n];
        const ultima = n === destinos.length - 1;
        const share = ultima ? restante : restante * fraccionCamino;
        if (share <= EPS_CANT) continue;
        depositar(
          materialSig,
          cantidadSig,
          vxSig,
          vySig,
          dest,
          mat,
          share,
          vxN,
          vyN,
        );
        const kImp = T > EPS_CANT ? impulsoCamino * (share / T) : 0;
        vxSig[dest] = clamp(vxSig[dest] + dirx * kImp, -vmax, vmax);
        vySig[dest] = clamp(vySig[dest] + diry * kImp, -vmax, vmax);
        restante -= share;
        depositado += share;
        ultimo = dest;
        const destX = (dest % mundo.stride) - PAD;
        const destY = Math.floor(dest / mundo.stride) - PAD;
        mundo.marcarChunk(destX, destY);
      }

      if (depositado <= EPS_CANT) {
        if (materialSig[i] === mat) {
          vxSig[i] = vxN;
          vySig[i] = vyN;
        }
        mundo.marcarChunk(x, y);
        return;
      }

      vaciarOrigen(materialSig, cantidadSig, vxSig, vySig, i, depositado);
      if (materialSig[i] === mat) {
        vxSig[i] = vxN;
        vySig[i] = vyN;
      }

      const destX = (ultimo % mundo.stride) - PAD;
      const destY = Math.floor(ultimo / mundo.stride) - PAD;
      mundo.marcarChunk(x, y);
      mundo.marcarChunk(destX, destY);
    },
    { alternarFilas: true },
  );

  mundo.intercambiar();
}

function pasoInteracciones(mundo) {
  const { material, cantidad, vx, vy, stride } = mundo;

  mundo.recorrerCeldas((x, y, i) => {
    const mat = material[i];
    if (!esFluido(mat) && !esSolido(mat)) return;
    for (const [dx, dy] of VECINOS) {
      const j = i + dy * stride + dx;
      const matJ = material[j];
      if (matJ === AIRE) continue;
      const fn = REACCIONES.get(clavePar(mat, matJ));
      if (!fn) continue;
      if (i < j) {
        fn(mundo, i, j, mat, matJ);
        mundo.marcarChunk(x, y);
        mundo.marcarChunk(x + dx, y + dy);
      }
    }
  });

  mundo.recorrerCeldas(
    (x, y, i) => {
      if (y >= mundo.alto - 1) return;
      const matA = material[i];
      if (!esFluido(matA) || vacia(cantidad[i])) return;
      const j = i + stride;
      const matB = material[j];
      if (!esFluido(matB) || vacia(cantidad[j])) return;
      if (matA === matB) return;
      if (MATERIALES[matA].densidad <= MATERIALES[matB].densidad) return;

      const cA = cantidad[i],
        cB = cantidad[j];
      const vxA = vx[i],
        vyA = vy[i];
      material[i] = matB;
      cantidad[i] = cB;
      vx[i] = vx[j];
      vy[i] = vy[j];
      material[j] = matA;
      cantidad[j] = cA;
      vx[j] = vxA;
      vy[j] = vyA;
      mundo.marcarChunk(x, y);
      mundo.marcarChunk(x, y + 1);
    },
    { desdeAbajo: true },
  );
}

const ordenPasos = [
  {
    id: "gravedad",
    nombre: "Gravedad",
    desc: "Baja masa si abajo hay aire o el mismo material (sin bajar del piso de gravedad).",
    tooltip:
      "Baja masa a la celda de abajo: si es aire cae libre; si es el mismo material, sin bajar del pisoGravedad del material. Anota dadoY. Impulso opcional a vy.",
    activo: true,
    fn: pasoGravedad,
    cfg: { flujo: 1, impulso: 0 },
    knobs: [
      {
        key: "flujo",
        corto: "flujo",
        label: "Flujo hacia abajo",
        min: 0,
        max: 20,
        step: 0.25,
        tooltip:
          "Partículas que bajan por tick si abajo es aire o el mismo material (sin bajar del piso). 0 = no cae masa.",
      },
      {
        key: "impulso",
        corto: "imp",
        label: "Impulso vy",
        min: 0,
        max: 2,
        step: 0.01,
        tooltip:
          "Suma a vy solo si abajo es aire. 0 = el loop es solo masa→dado→vector.",
      },
    ],
  },
  {
    id: "fick",
    nombre: "Difusión de presión (Fick)",
    desc: "Nivela presión: la masa fluye de celdas cargadas a vecinas menos cargadas.",
    tooltip:
      "P = max(0, n − reposo). Moore-8, Jacobi: escala si la suma de outflows supera el exceso. Solo presión; no mueve por v (eso es Advección).",
    activo: true,
    fn: pasoDifusionFick,
    cfg: { tasa: 0.25, multiplicadorPresion: 1.0, flujoMax: 8 },
    knobs: [
      {
        key: "tasa",
        corto: "tasa",
        label: "Tasa",
        min: 0,
        max: 2,
        step: 0.05,
        tooltip:
          "Fracción de (P_i − P_j)×invDist por vecino Moore-8. 0 = no se nivela.",
      },
      {
        key: "multiplicadorPresion",
        corto: "P×",
        label: "Multiplicador presión",
        min: 0,
        max: 4,
        step: 0.05,
        tooltip:
          "Escala P → flujo. 1 = el de siempre. Subilo para chorro más agresivo.",
      },
      {
        key: "flujoMax",
        corto: "tope",
        label: "Flujo máximo",
        min: 1,
        max: 2000,
        step: 1,
        tooltip:
          "Techo de partículas por arista por tick. Un millón no pasa de un saque.",
      },
    ],
  },
  {
    id: "vector",
    nombre: "Campo de velocidades",
    desc: "Calcula la flecha v de cada celda: inercia + presión + flujos dados/recibidos.",
    tooltip:
      "Un v por celda: inercia + presión + dadas/recibidas, promedio con vecinos. No mueve masa: eso lo hacen Difusión y Advección.",
    activo: true,
    fn: pasoGenerarVector,
    cfg: {
      epsilon: 0.69,
      infFick: 0.06,
      infDadas: 0.1,
      infRecibidas: 0.24,
      compresionFlujo: 0.5,
      promedioMix: 1,
      radioBlur: 1,
      inercia: 0.99,
    },
    knobs: [
      {
        key: "epsilon",
        corto: "eps",
        label: "Epsilon",
        min: 0,
        max: 1,
        step: 0.01,
        tooltip: "Por debajo, v = 0. Subilo si ves temblor eterno.",
      },
      {
        key: "infFick",
        corto: "fick",
        label: "Influencia Fick",
        min: 0,
        max: 2,
        step: 0.02,
        tooltip:
          "Quiere salir según gradiente de P, aunque el flujo esté tapado.",
      },
      {
        key: "infDadas",
        corto: "dadas",
        label: "Influencia dadas",
        min: 0,
        max: 2,
        step: 0.02,
        tooltip: "Partículas que esta celda dio. Apunta al hueco.",
      },
      {
        key: "infRecibidas",
        corto: "recib",
        label: "Influencia recibidas",
        min: 0,
        max: 2,
        step: 0.02,
        tooltip: "Partículas que llegaron. Continúa el chorro hacia afuera.",
      },
      {
        key: "compresionFlujo",
        corto: "log",
        label: "Compresión flujo",
        min: 0,
        max: 1,
        step: 0.05,
        tooltip:
          "0 = lineal. 1 = log(1+|flujo|). Evita que 1e6 sature vMax de un tick.",
      },
      {
        key: "promedioMix",
        corto: "prom",
        label: "Promedio",
        min: 0,
        max: 1,
        step: 0.05,
        tooltip: "Mezcla v con vecinos del mismo material (× viscosidad).",
      },
      {
        key: "radioBlur",
        corto: "radio",
        label: "Radio del promedio",
        min: 1,
        max: 3,
        step: 1,
        tooltip: "1 = 3×3, 2 = 5×5, 3 = 7×7.",
      },
      {
        key: "inercia",
        corto: "iner",
        label: "Inercia",
        min: 0.9,
        max: 0.9999,
        step: 0.0001,
        tooltip: "v *= esto cada tick. 0.99 olvida despacio. 0.9 frena ya.",
      },
    ],
  },
  {
    id: "movimiento",
    nombre: "Advección (movimiento por velocidad)",
    desc: "La masa sigue la flecha v de su celda, como el viento arrastrando humo.",
    tooltip:
      "Advecta cantidad según el campo v del paso Campo de velocidades. Deposita en el camino y empuja vectores intermedios. Caudal 0 = apagado; el checkbox es el apagado total.",
    activo: true,
    fn: pasoMovimiento,
    cfg: {
      caudal: 8,
      umbralSplash: 4.0,
      fraccionCamino: 0,
      impulsoCamino: 0,
      splashNormal: 0.4,
      splashRuido: 1.2,
      splashHerencia: 0.2,
      splashFraccion: 0.5,
    },
    knobs: [
      {
        key: "caudal",
        corto: "caudal",
        label: "Caudal",
        min: 0,
        max: 80,
        step: 1,
        tooltip:
          "Cantidad máxima que se mueve por tick, proporcional a |v|. 0 = paso apagado.",
      },
      {
        key: "umbralSplash",
        corto: "splash",
        label: "Umbral splash",
        min: 0,
        max: 12,
        step: 0.1,
        tooltip: "Impacto mínimo contra sólido para salpicar. 12 ≈ nunca.",
      },
      {
        key: "fraccionCamino",
        corto: "camino",
        label: "Fracción camino",
        min: 0,
        max: 1,
        step: 0.02,
        tooltip:
          "Cuánto se queda en cada agua intermedia. 0 = todo al final (viejo). ~0.3 = chorro que moja.",
      },
      {
        key: "impulsoCamino",
        corto: "impulso",
        label: "Impulso camino",
        min: 0,
        max: 4,
        step: 0.05,
        tooltip:
          "Suma a v de las celdas del rayo. Encadena el chorro el tick siguiente.",
      },
      {
        key: "splashNormal",
        corto: "sN",
        label: "Splash normal",
        min: 0,
        max: 2,
        step: 0.05,
        tooltip: "Rebote de salpicadura según la normal del choque.",
      },
      {
        key: "splashRuido",
        corto: "sR",
        label: "Splash ruido",
        min: 0,
        max: 3,
        step: 0.05,
        tooltip: "Aleatorio en la velocidad de las gotas.",
      },
      {
        key: "splashHerencia",
        corto: "sH",
        label: "Splash herencia",
        min: 0,
        max: 1,
        step: 0.05,
        tooltip: "Cuánto la gota hereda v del origen.",
      },
      {
        key: "splashFraccion",
        corto: "sF",
        label: "Splash fracción",
        min: 0,
        max: 1,
        step: 0.05,
        tooltip: "Tope de masa que se reparte al salpicar.",
      },
    ],
  },
  {
    id: "interacciones",
    nombre: "Interacciones",
    desc: "Swap por densidad (el más pesado baja) y lava+agua → piedra.",
    tooltip: "Swap por densidad y lava+agua → piedra. Knobs en Materiales.",
    activo: true,
    fn: pasoInteracciones,
    cfg: {},
    knobs: [],
    ayuda: "Sin knobs propios. Densidad y reposo están en cada material.",
  },
];

// Snapshots de defaults para restablecer cfg de pasos y coeficientes de materiales.
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

function marcarChunksPorVelocidad(mundo) {
  const { material, cantidad, vx, vy } = mundo;
  const umbral = config.umbralCampo ?? 0.05;
  mundo.recorrerCeldas((x, y, i) => {
    if (!esFluido(material[i]) || vacia(cantidad[i])) return;
    if (Math.abs(vx[i]) > umbral || Math.abs(vy[i]) > umbral) {
      mundo.marcarChunk(x, y);
    }
  });
}

// Un tick completo: corre los pasos activos en orden. Si se pasa `tiempos`, lo llena con ms por paso. Devuelve ms totales.
function tick(mundo, tiempos) {
  mundo.expandirChunks();
  mundo.dadoX.fill(0);
  mundo.dadoY.fill(0);
  mundo.recibidoX.fill(0);
  mundo.recibidoY.fill(0);
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
  marcarChunksPorVelocidad(mundo);
  mundo.chunksActivos.set(mundo.chunksActivosSig);
  return performance.now() - t0;
}

function medirMasa(mundo) {
  const { material, cantidad } = mundo;
  let total = 0;
  let vivas = 0;
  const porMat = new Float64Array(MATERIALES.length);
  for (let y = 0; y < mundo.alto; y++) {
    for (let x = 0; x < mundo.ancho; x++) {
      const i = mundo.idx(x, y);
      const mat = material[i];
      if (!esFluido(mat) || vacia(cantidad[i])) continue;
      total += cantidad[i];
      porMat[mat] += cantidad[i];
      vivas++;
    }
  }
  return { total, porMat, vivas };
}

const LAB_CORE = {
  VMAX,
  PAD,
  CHUNK,
  EPS_CANT,
  VECINOS,
  MOORE,
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
  presionDe,
  config,
  Mundo,
  ordenPasos,
  restablecerPasos,
  restablecerMateriales,
  tick,
  medirMasa,
  marcarChunksPorVelocidad,
  pasoGravedad,
  pasoDifusionFick,
  pasoGenerarVector,
  pasoMovimiento,
  pasoInteracciones,
};

if (typeof module !== "undefined" && module.exports) module.exports = LAB_CORE;
else globalThis.LAB_CORE = LAB_CORE;
