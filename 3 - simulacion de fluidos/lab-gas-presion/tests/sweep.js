"use strict";

// Barrido de parámetros sobre un escenario: producto cartesiano de valores, métricas finales en CSV.
// Uso: node tests/sweep.js columna --set materiales.AGUA.reposo=0,1,2,4,8 --set fick.tasa=0.1,0.25,0.5 [--ticks 300]
// Paths: materiales.<NOMBRE>.<prop> · config.<prop> · <pasoId>.<knob>

const fs = require("fs");
const path = require("path");
const CORE = require("../core.js");
const { ESCENARIOS, construirEscenario } = require("../escenarios.js");
const { medirMetricas, asegurarOut, DIR_OUT } = require("./metricas.js");

function resolverPath(pathStr) {
  if (pathStr.startsWith("materiales.")) {
    const [, nombre, prop] = pathStr.split(".");
    const mat = CORE.MATERIALES.find(
      (m) => m.nombre.toUpperCase() === nombre.toUpperCase(),
    );
    if (!mat) throw new Error(`Material desconocido: ${nombre}`);
    return {
      get: () => mat[prop],
      set: (v) => (mat[prop] = v),
    };
  }
  if (pathStr.startsWith("config.")) {
    const prop = pathStr.slice("config.".length);
    return {
      get: () => CORE.config[prop],
      set: (v) => (CORE.config[prop] = v),
    };
  }
  const [pasoId, key] = pathStr.split(".");
  const paso = CORE.ordenPasos.find((p) => p.id === pasoId);
  if (!paso || !(key in paso.cfg))
    throw new Error(`Knob desconocido: ${pathStr}`);
  return {
    get: () => paso.cfg[key],
    set: (v) => (paso.cfg[key] = v),
  };
}

function main() {
  const args = process.argv.slice(2);
  const escId = args.find((a) => !a.startsWith("--"));
  const esc = ESCENARIOS.find((e) => e.id === escId);
  if (!esc) {
    console.log(
      `Escenario '${escId}' no existe. Disponibles: ${ESCENARIOS.map((e) => e.id).join(", ")}`,
    );
    process.exit(1);
  }

  const sets = [];
  let ticksOverride;
  for (let n = 0; n < args.length; n++) {
    if (args[n] === "--set") {
      const [pathStr, valoresStr] = args[n + 1].split("=");
      const valores = valoresStr.split(",").map(Number);
      if (valores.some(Number.isNaN))
        throw new Error(`Valores no numéricos en ${args[n + 1]}`);
      sets.push({ pathStr, valores });
      n++;
    } else if (args[n] === "--ticks") {
      ticksOverride = Number(args[n + 1]);
      n++;
    }
  }
  if (sets.length === 0) {
    console.log("Falta al menos un --set path=v1,v2,...");
    process.exit(1);
  }

  const ticks = ticksOverride ?? esc.ticks ?? 300;
  const combos = sets.reduce(
    (acc, s) =>
      acc.flatMap((combo) =>
        s.valores.map((v) => [...combo, { pathStr: s.pathStr, v }]),
      ),
    [[]],
  );

  console.log(
    `${combos.length} corridas × ${ticks} ticks sobre '${esc.id}'...\n`,
  );
  const columnas = sets.map((s) => s.pathStr);
  const encabezado = [
    ...columnas,
    "masa0",
    "masa1",
    "deltaPct",
    "energia",
    "maxV",
    "vivas",
    "supStd",
    "msTick",
  ];
  const filas = [encabezado.join(",")];

  for (const combo of combos) {
    const mundo = construirEscenario(CORE, esc);
    for (const { pathStr, v } of combo) resolverPath(pathStr).set(v);
    const m0 = CORE.medirMasa(mundo).total;
    const t0 = performance.now();
    for (let t = 0; t < ticks; t++) CORE.tick(mundo);
    const msTick = (performance.now() - t0) / ticks;
    const met = medirMetricas(CORE, mundo);
    const deltaPct = m0 > 0 ? (100 * (met.masa - m0)) / m0 : 0;
    const fila = [
      ...combo.map((c) => c.v),
      m0.toFixed(2),
      met.masa.toFixed(2),
      deltaPct.toFixed(3),
      met.energia.toFixed(3),
      met.maxV.toFixed(3),
      met.vivas,
      met.superficieStd.toFixed(3),
      msTick.toFixed(3),
    ];
    filas.push(fila.join(","));
    console.log(fila.join("  "));
  }

  asegurarOut();
  const ruta = path.join(DIR_OUT, `sweep-${esc.id}.csv`);
  fs.writeFileSync(ruta, filas.join("\n") + "\n");
  console.log(`\nCSV: ${ruta}`);
}

main();
