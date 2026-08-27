"use strict";

// Métricas y snapshots compartidos entre run.js y sweep.js.

const fs = require("fs");
const path = require("path");

const DIR_OUT = path.join(__dirname, "out");

function asegurarOut() {
  fs.mkdirSync(DIR_OUT, { recursive: true });
}

function medirMetricas(CORE, mundo) {
  const { material, cantidad, vx, vy } = mundo;
  let energia = 0;
  let maxV = 0;
  let sinNaN = true;
  const topPorColumna = [];
  for (let x = 0; x < mundo.ancho; x++) {
    let top = -1;
    for (let y = 0; y < mundo.alto; y++) {
      const i = mundo.idx(x, y);
      const n = cantidad[i];
      if (!Number.isFinite(n) || !Number.isFinite(vx[i]) || !Number.isFinite(vy[i]))
        sinNaN = false;
      if (!CORE.esFluido(material[i]) || CORE.vacia(n)) continue;
      if (top < 0) top = y;
      const v2 = vx[i] * vx[i] + vy[i] * vy[i];
      energia += 0.5 * n * v2;
      const mag = Math.sqrt(v2);
      if (mag > maxV) maxV = mag;
    }
    if (top >= 0) topPorColumna.push(top);
  }
  let superficieStd = 0;
  if (topPorColumna.length > 1) {
    const media =
      topPorColumna.reduce((a, b) => a + b, 0) / topPorColumna.length;
    superficieStd = Math.sqrt(
      topPorColumna.reduce((a, t) => a + (t - media) ** 2, 0) /
        topPorColumna.length,
    );
  }
  const { total, porMat, vivas } = CORE.medirMasa(mundo);
  return {
    masa: total,
    porMat: Array.from(porMat),
    vivas,
    energia,
    maxV,
    sinNaN,
    superficieStd,
  };
}

function centroMasaY(CORE, mundo, idMat) {
  const { material, cantidad } = mundo;
  let suma = 0;
  let total = 0;
  for (let y = 0; y < mundo.alto; y++) {
    for (let x = 0; x < mundo.ancho; x++) {
      const i = mundo.idx(x, y);
      if (material[i] !== idMat || CORE.vacia(cantidad[i])) continue;
      total += cantidad[i];
      suma += cantidad[i] * y;
    }
  }
  return total > 0 ? suma / total : NaN;
}

function redondear(arr, decimales = 6) {
  const k = 10 ** decimales;
  return Array.from(arr, (v) => Math.round(v * k) / k);
}

function snapshot(mundo, ruta, meta) {
  asegurarOut();
  const ancho = mundo.ancho;
  const alto = mundo.alto;
  const material = new Array(ancho * alto);
  const cantidad = new Array(ancho * alto);
  const vx = new Array(ancho * alto);
  const vy = new Array(ancho * alto);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = mundo.idx(x, y);
      const p = y * ancho + x;
      material[p] = mundo.material[i];
      cantidad[p] = mundo.cantidad[i];
      vx[p] = mundo.vx[i];
      vy[p] = mundo.vy[i];
    }
  }
  const datos = {
    ...meta,
    ancho,
    alto,
    material,
    cantidad: redondear(cantidad),
    vx: redondear(vx, 4),
    vy: redondear(vy, 4),
  };
  fs.writeFileSync(ruta, JSON.stringify(datos));
  return ruta;
}

module.exports = {
  DIR_OUT,
  asegurarOut,
  medirMetricas,
  centroMasaY,
  snapshot,
};
