"use strict";

// Runner científico: corre la suite unidad + escenarios, mide, guarda snapshots y evalúa invariantes.
// Uso: node tests/run.js [--escenario columna] [--ticks 500] [--dump]

const path = require("path");
const CORE = require("../core.js");
const { ESCENARIOS, construirEscenario } = require("../escenarios.js");
const {
  asegurarOut,
  medirMetricas,
  centroMasaY,
  snapshot,
  DIR_OUT,
} = require("./metricas.js");

const {
  Mundo,
  MATERIALES,
  AGUA,
  PIEDRA,
  EPS_CANT,
  esFluido,
  pasoGravedad,
  pasoDifusionFick,
  pasoGenerarVector,
  pasoMovimiento,
} = CORE;

// ---------- Suite unidad (migrada de lab.js) ----------

function suiteUnidad() {
  const masaDe = (m) => {
    let t = 0;
    for (let y = 0; y < m.alto; y++) {
      for (let x = 0; x < m.ancho; x++) {
        const i = m.idx(x, y);
        if (esFluido(m.material[i])) t += m.cantidad[i];
      }
    }
    return t;
  };
  const casiIgual = (a, b) => Math.abs(a - b) < 1e-3;
  const m = new Mundo(8, 8);
  const i0 = m.idx(3, 3);
  const iAire = m.idx(4, 3);

  m.pintar(3, 3, 0, AGUA, MATERIALES[AGUA].reposo);
  const masaReposo = masaDe(m);
  pasoDifusionFick(m, { tasa: 1 });
  if (!casiIgual(m.cantidad[i0], MATERIALES[AGUA].reposo))
    throw new Error("Fick emitió bajo reposo");
  if (!casiIgual(masaDe(m), masaReposo))
    throw new Error("Fick no conservó masa (reposo)");

  m.limpiar();
  m.pintar(3, 7, 0, AGUA, 8);
  m.pintar(3, 6, 0, AGUA, 10);
  const iOri = m.idx(3, 6);
  const iAb = m.idx(3, 7);
  const masaG = masaDe(m);
  pasoGravedad(m, { flujo: 1, impulso: 0 });
  if (!casiIgual(masaDe(m), masaG))
    throw new Error("Gravedad no conservó masa");
  if (!casiIgual(m.cantidad[iOri], 9) || !casiIgual(m.cantidad[iAb], 9))
    throw new Error("Gravedad no bajó flujo al mismo material");
  if (m.dadoY[iOri] <= 0 || m.recibidoY[iAb] <= 0)
    throw new Error("Gravedad no anotó dadoY/recibidoY");

  m.limpiar();
  const pisoAntes = MATERIALES[AGUA].pisoGravedad;
  MATERIALES[AGUA].pisoGravedad = MATERIALES[AGUA].reposo;
  m.pintar(3, 7, 0, AGUA, MATERIALES[AGUA].reposo);
  m.pintar(3, 6, 0, AGUA, MATERIALES[AGUA].reposo);
  pasoGravedad(m, { flujo: 1, impulso: 0 });
  MATERIALES[AGUA].pisoGravedad = pisoAntes;
  if (!casiIgual(m.cantidad[m.idx(3, 6)], MATERIALES[AGUA].reposo))
    throw new Error("Gravedad drenó bajo pisoGravedad");

  m.limpiar();
  m.pintar(3, 3, 0, AGUA, 20);
  m.vx[i0] = 2;
  const masa0 = masaDe(m);
  const vxAntes = m.vx[i0];
  pasoDifusionFick(m, { tasa: 1 });
  if (!casiIgual(masaDe(m), masa0))
    throw new Error("Fick no conservó masa (exceso)");
  if (m.cantidad[iAire] <= EPS_CANT)
    throw new Error("Fick no movió exceso al aire");
  if (
    esFluido(m.material[i0]) &&
    m.cantidad[i0] > EPS_CANT &&
    m.vx[i0] !== vxAntes
  ) {
    throw new Error("Fick escribió velocidad");
  }
  const masa1 = masaDe(m);
  m.vx[i0] = 3;
  pasoMovimiento(m, { caudal: 28, umbralSplash: 99 });
  if (!casiIgual(masaDe(m), masa1)) throw new Error("DDA no conservó masa");

  m.limpiar();
  m.pintar(3, 3, 0, AGUA, 1e4);
  m.pintar(2, 3, 0, PIEDRA, 1);
  pasoDifusionFick(m, {
    tasa: 1,
    multiplicadorPresion: 1,
    flujoMax: 50,
  });
  if (m.cantidad[iAire] > 50 + 1e-3) throw new Error("Fick superó flujoMax");
  if (m.cantidad[iAire] <= EPS_CANT)
    throw new Error("Fick no transfirió con exceso");
  if (m.dadoX[i0] <= 0) throw new Error("Fick no anotó dado del origen");
  if (m.recibidoX[iAire] <= 0)
    throw new Error("Fick no anotó recibido del aire");
  pasoGenerarVector(m, {
    epsilon: 0,
    infFick: 0.35,
    infDadas: 0.8,
    infRecibidas: 0.8,
    compresionFlujo: 0.7,
  });
  if (m.vx[iAire] <= 0)
    throw new Error("Vector destino no empuja hacia afuera");

  m.limpiar();
  const iOrig = m.idx(1, 3);
  const iMid = m.idx(2, 3);
  m.pintar(1, 3, 0, AGUA, 100);
  m.pintar(2, 3, 0, AGUA, 10);
  m.vx[iOrig] = 3;
  const nMid = m.cantidad[iMid];
  const masaDda = masaDe(m);
  pasoMovimiento(m, {
    caudal: 28,
    umbralSplash: 99,
    fraccionCamino: 0.3,
    impulsoCamino: 1,
  });
  if (!casiIgual(masaDe(m), masaDda))
    throw new Error("DDA camino no conservó masa");
  if (m.cantidad[iMid] <= nMid)
    throw new Error("DDA no depositó en celda intermedia");

  m.limpiar();
  m.pintar(3, 3, 0, AGUA, 20);
  m.vx[m.idx(3, 3)] = 3;
  pasoMovimiento(m, { caudal: 0, umbralSplash: 99 });
  if (!casiIgual(m.cantidad[m.idx(3, 3)], 20))
    throw new Error("DDA con caudal 0 movió masa");

  m.limpiar();
  m.pintar(3, 3, 0, AGUA, MATERIALES[AGUA].reposo);
  m.vx[m.idx(3, 3)] = 3;
  pasoDifusionFick(m, { tasa: 1 });
  if (!casiIgual(m.cantidad[m.idx(3, 3)], MATERIALES[AGUA].reposo))
    throw new Error("Fick emitió bajo reposo con velocidad");
}

// ---------- Escenarios ----------

function evaluarInvariantes(CORE, mundo, esc, m0, met) {
  const inv = esc.invariantes || {};
  const fallas = [];
  if (inv.masaTotal !== undefined) {
    if (Math.abs(met.masa - inv.masaTotal) > 1e-3)
      fallas.push(`masaTotal esperado ${inv.masaTotal}, hay ${met.masa}`);
  }
  if (inv.masaConservada !== undefined) {
    const tol = inv.masaConservada * Math.max(1, m0);
    if (Math.abs(met.masa - m0) > tol)
      fallas.push(
        `masa no conservada: ${m0.toFixed(3)} → ${met.masa.toFixed(3)}`,
      );
  }
  if (inv.sinNaN && !met.sinNaN) fallas.push("hay NaN/Infinity en las celdas");
  if (inv.maxVFinal !== undefined && met.maxV > inv.maxVFinal + 1e-9)
    fallas.push(`maxV final ${met.maxV.toFixed(3)} > ${inv.maxVFinal}`);
  if (inv.energiaMaxFinal !== undefined && met.energia > inv.energiaMaxFinal)
    fallas.push(
      `energía final ${met.energia.toFixed(3)} > ${inv.energiaMaxFinal}`,
    );
  if (inv.centroMasas) {
    const idDe = (nombre) =>
      MATERIALES.find((mm) => mm.nombre.toUpperCase() === nombre.toUpperCase())
        .id;
    const yArriba = centroMasaY(CORE, mundo, idDe(inv.centroMasas.arriba));
    const yAbajo = centroMasaY(CORE, mundo, idDe(inv.centroMasas.abajo));
    if (!(yArriba < yAbajo))
      fallas.push(
        `centro de masa de ${inv.centroMasas.arriba} (y=${yArriba.toFixed(1)}) no quedó arriba de ${inv.centroMasas.abajo} (y=${yAbajo.toFixed(1)})`,
      );
  }
  return fallas;
}

function correrEscenario(esc, { ticksOverride, dump }) {
  const mundo = construirEscenario(CORE, esc);
  const ticks = ticksOverride ?? esc.ticks ?? 300;
  const m0 = CORE.medirMasa(mundo).total;
  const t0 = performance.now();
  for (let t = 1; t <= ticks; t++) {
    CORE.tick(mundo);
    if (dump && t % 50 === 0) {
      snapshot(
        mundo,
        path.join(DIR_OUT, `${esc.id}-tick${t}.json`),
        { escenario: esc.id, tick: t },
      );
    }
  }
  const msTick = (performance.now() - t0) / ticks;
  const met = medirMetricas(CORE, mundo);
  const fallas = evaluarInvariantes(CORE, mundo, esc, m0, met);
  if (dump) {
    snapshot(mundo, path.join(DIR_OUT, `${esc.id}-final.json`), {
      escenario: esc.id,
      tick: ticks,
    });
  }
  return { mundo, m0, met, msTick, fallas, ticks };
}

function imprimirFila(id, r) {
  const { m0, met, msTick, fallas, ticks } = r;
  const estado = fallas.length === 0 ? "OK  " : "FALLA";
  console.log(
    `${estado} ${id} · ${ticks} ticks · ${msTick.toFixed(2)}ms/tick · ` +
      `masa ${m0.toFixed(1)}→${met.masa.toFixed(1)} · E ${met.energia.toFixed(2)} · ` +
      `maxV ${met.maxV.toFixed(2)} · vivas ${met.vivas} · supStd ${met.superficieStd.toFixed(2)}`,
  );
  for (const f of fallas) console.log(`      - ${f}`);
}

function main() {
  const args = process.argv.slice(2);
  const leer = (flag) => {
    const n = args.indexOf(flag);
    return n >= 0 ? args[n + 1] : undefined;
  };
  const soloEsc = leer("--escenario");
  const ticksOverride = leer("--ticks") ? Number(leer("--ticks")) : undefined;
  const dump = args.includes("--dump");

  asegurarOut();
  let fallasTotales = 0;

  try {
    suiteUnidad();
    console.log("OK   suite unidad");
  } catch (e) {
    console.log(`FALLA suite unidad: ${e.message}`);
    fallasTotales++;
  }

  const lista = soloEsc
    ? ESCENARIOS.filter((e) => e.id === soloEsc)
    : ESCENARIOS;
  if (lista.length === 0) {
    console.log(`No existe escenario '${soloEsc}'`);
    process.exit(1);
  }

  for (const esc of lista) {
    const r = correrEscenario(esc, { ticksOverride, dump });
    imprimirFila(esc.id, r);
    fallasTotales += r.fallas.length;
  }

  if (dump) console.log(`Snapshots en ${DIR_OUT}`);
  process.exit(fallasTotales === 0 ? 0 : 1);
}

main();
