"use strict";

// Escenarios de prueba compartidos entre browser (panel Escenarios) y Node (tests/run.js, tests/sweep.js).
// Grilla ASCII: `.` aire · `#` piedra · `s` arena · `~` agua · `o` aceite · `L` lava.
// Cantidad inicial: reposo del material (1 para sólidos). Fila 0 = arriba.

const MAPA_CHARS = {
  ".": "AIRE",
  "#": "PIEDRA",
  s: "ARENA",
  "~": "AGUA",
  o: "ACEITE",
  L: "LAVA",
};

const VACIA_32 = "#..............................#";
const PISO_32 = "################################";
const AGUA_32 = "#~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~#";
const COLUMNA_32 = "#...........~~~~~~~~...........#"; // 8 de agua, centrada
const BLOQUE_32 = "#.........~~~~~~~~~~~~.........#"; // 12 de agua, centrada
const AGUA16_32 = "#.......~~~~~~~~~~~~~~~~.......#";
const ACEITE_32 = "#oooooooooooooooooooooooooooooo#";

function grillaDe(filas) {
  return filas;
}
function filasVacias(n) {
  return Array(n).fill(VACIA_32);
}

const ESCENARIOS = [
  {
    id: "vacio",
    nombre: "Vacío (sanidad)",
    descripcion: "Aire solo. 100 ticks no deben crear masa ni NaN.",
    ancho: 32,
    alto: 32,
    ticks: 100,
    invariantes: { masaTotal: 0, sinNaN: true },
  },
  {
    id: "columna",
    nombre: "Columna hidrostática",
    descripcion:
      "Columna de agua 8×20 en caja. Mide conservación, settling y superficie.",
    ancho: 32,
    alto: 32,
    grilla: grillaDe([
      ...filasVacias(11),
      ...Array(20).fill(COLUMNA_32),
      PISO_32,
    ]),
    ticks: 300,
    invariantes: { masaConservada: 1e-2, sinNaN: true },
  },
  {
    id: "gota",
    nombre: "Gota en caída libre",
    descripcion: "100 de agua en una celda cae, pega en el piso y salpica.",
    ancho: 32,
    alto: 32,
    grilla: grillaDe([...filasVacias(31), PISO_32]),
    pintas: [{ x: 16, y: 4, radio: 0, mat: "AGUA", cantidad: 100 }],
    ticks: 200,
    invariantes: { masaConservada: 1e-2, sinNaN: true },
  },
  {
    id: "derrame",
    nombre: "Derrame en pileta",
    descripcion: "Bloque de agua 12×8 cae al fondo y debe nivelarse.",
    ancho: 32,
    alto: 32,
    grilla: grillaDe([
      ...filasVacias(4),
      ...Array(8).fill(BLOQUE_32),
      ...filasVacias(19),
      PISO_32,
    ]),
    ticks: 400,
    invariantes: { masaConservada: 1e-2, sinNaN: true },
  },
  {
    id: "densidades",
    nombre: "Aceite bajo agua (swap)",
    descripcion:
      "Agua arriba, aceite abajo: el swap por densidad debe invertir las capas.",
    ancho: 32,
    alto: 32,
    grilla: grillaDe([
      ...filasVacias(16),
      ...Array(7).fill(AGUA_32),
      ...Array(8).fill(ACEITE_32),
      PISO_32,
    ]),
    ticks: 600,
    invariantes: {
      masaConservada: 1e-2,
      sinNaN: true,
      centroMasas: { arriba: "ACEITE", abajo: "AGUA" },
    },
  },
  {
    id: "estable-reposo",
    nombre: "Pileta en reposo estable",
    descripcion:
      "Pileta exactamente a reposo con pisoGravedad = reposo: no debe moverse nada.",
    ancho: 32,
    alto: 32,
    grilla: grillaDe([...filasVacias(24), ...Array(7).fill(AGUA_32), PISO_32]),
    materiales: { AGUA: { pisoGravedad: 8 } },
    ticks: 100,
    invariantes: { masaConservada: 1e-6, maxVFinal: 0, sinNaN: true },
  },
];

function nombreAId(CORE, nombre) {
  const mat = CORE.MATERIALES.find(
    (m) => m.nombre.toUpperCase() === String(nombre).toUpperCase(),
  );
  if (!mat) throw new Error(`Material desconocido: ${nombre}`);
  return mat.id;
}

function aplicarGrilla(CORE, mundo, grilla) {
  if (grilla.length !== mundo.alto)
    throw new Error(
      `Grilla tiene ${grilla.length} filas, esperadas ${mundo.alto}`,
    );
  for (let y = 0; y < grilla.length; y++) {
    const fila = grilla[y];
    if (fila.length !== mundo.ancho)
      throw new Error(
        `Fila ${y} tiene ${fila.length} columnas, esperadas ${mundo.ancho}`,
      );
    for (let x = 0; x < fila.length; x++) {
      const nombre = MAPA_CHARS[fila[x]];
      if (!nombre)
        throw new Error(`Caracter desconocido '${fila[x]}' en ${x},${y}`);
      const id = nombreAId(CORE, nombre);
      if (id === CORE.AIRE) continue;
      const cantidad = CORE.esSolido(id) ? 1 : CORE.MATERIALES[id].reposo;
      mundo.pintar(x, y, 0, id, cantidad);
    }
  }
}

// Resetea cfg de pasos y materiales a defaults, aplica overrides del escenario y construye el mundo.
function construirEscenario(CORE, esc) {
  CORE.restablecerPasos();
  CORE.restablecerMateriales();
  if (esc.cfg) {
    for (const [pasoId, knobs] of Object.entries(esc.cfg)) {
      const paso = CORE.ordenPasos.find((p) => p.id === pasoId);
      if (!paso) throw new Error(`Paso desconocido en cfg: ${pasoId}`);
      Object.assign(paso.cfg, knobs);
    }
  }
  if (esc.materiales) {
    for (const [nombre, props] of Object.entries(esc.materiales)) {
      const mat = CORE.MATERIALES.find(
        (m) => m.nombre.toUpperCase() === nombre.toUpperCase(),
      );
      if (!mat) throw new Error(`Material desconocido: ${nombre}`);
      Object.assign(mat, props);
    }
  }
  const mundo = new CORE.Mundo(esc.ancho, esc.alto);
  if (esc.grilla) aplicarGrilla(CORE, mundo, esc.grilla);
  if (esc.pintas) {
    for (const p of esc.pintas) {
      mundo.pintar(p.x, p.y, p.radio ?? 0, nombreAId(CORE, p.mat), p.cantidad);
    }
  }
  return mundo;
}

const LAB_ESCENARIOS = { ESCENARIOS, MAPA_CHARS, construirEscenario };

if (typeof module !== "undefined" && module.exports)
  module.exports = LAB_ESCENARIOS;
else globalThis.LAB_ESCENARIOS = LAB_ESCENARIOS;
