const CONSTANTS = {
  // Thresholds and Base Values
  THRESH_HAMBRE_CRITICA: 70,
  THRESH_ENERGIA_BAJA: 30,
  THRESH_SED_CRITICA: 70,
  THRESH_FRIO_CRITICO: 70,
  THRESH_SOLEDAD_CRITICA: 70,

  HORA_DESPERTAR: 6,
  UMBRAL_ESCASEZ: 20,
  HAMBRE_TENSION: 90,
  EDAD_ADULTA: 18,
  EDAD_MUERTE_BASE: 80,

  // Relationship
  UMBRAL_PAREJA: 75,
  UMBRAL_ENAMORAMIENTO: 60,

  // Community Inventory Max Carry
  RACION_PARA_MENOR: 30,
  COMIDA_MINIMA_PARA_DONAR: 30,
  // Agua: litros por ración diaria (1 beber = 1 día de hidratación)
  AGUA_DIA_ADULTO: 2,
  AGUA_DIA_MENOR: 1,

  // Probabilidades y Umbrales Sociales
  PROB_CONCEPCION: 0.20,
  SOCIAL_CHANCE: 0.30,
  ROMANCE_MULTIPLIER: 1.0,
  HORAS_SOCIAL_CHECK: 12,

  // Calendario: 30 días = 1 año
  HORAS_POR_DIA: 24,
  DIAS_POR_ANIO: 30,
  HORAS_POR_ANIO: 720, // 30 * 24
  HORAS_EMBARAZO: 504, // 21 días
  DIAS_FRIO_HASTA: 15, // días 1–15 frío, 16–30 calor

  // Map
  MAP_WIDTH: 50,
  MAP_HEIGHT: 50,
  TILE_SIZE: 16,
  NOISE_SCALE: 0.1,
  UMBRAL_AGUA: -0.8,
  UMBRAL_BOSQUE: 0.4,
  CAMP_CLEAR_RADIUS: 3,

  // Ecosystem and Gathering
  PROB_ESPALIR_BOSQUE: 0.005, // por árbol, cada tick de ecosistema
  HORAS_ECOSYSTEM_TICK: 24,
  MADERA_POR_ARBOL: 100,
  COMIDA_POR_CAZA_EXITOSA: 150,

  // Housing / clima
  HORAS_CONSTRUCCION_CASA: 15,
  MADERA_POR_CASA: 10,
  MAX_ADULTOS_POR_CASA: 2,
  MADERA_FUEGO_POR_CASA: 1,

  // Duraciones
  DURACION_JITTER: 0.35
};

const NAMES_M = ['Lucas', 'Mateo', 'Diego', 'Nicolas', 'Facundo', 'Bruno', 'Leo', 'Joaquin', 'Ramiro', 'Thiago', 'Izan', 'Gael', 'Caleb'];
const NAMES_F = ['Valentina', 'Camila', 'Martina', 'Julieta', 'Emma', 'Florencia', 'Renata', 'Olivia', 'Isabella', 'Catalina', 'Mila', 'Zoe', 'Luna'];

/** Nombre único entre personas vivas (evita "Gael y Gael" en el log). */
function pickUniqueName(sexo) {
  let nameList = sexo === 'M' ? NAMES_M : NAMES_F;
  let taken = new Set(
    (window.Sim && window.Sim.personas ? window.Sim.personas : [])
      .filter(p => p.isAlive())
      .map(p => p.nombre)
  );
  let unused = nameList.filter(n => !taken.has(n));
  if (unused.length > 0) {
    return unused[Math.floor(window.RNG.next() * unused.length)];
  }
  let base = nameList[Math.floor(window.RNG.next() * nameList.length)];
  let n = 2;
  while (taken.has(base + n)) n++;
  return base + n;
}
window.pickUniqueName = pickUniqueName;

function jitterDuration(base) {
  let f = 1 + (window.RNG.next() * 2 - 1) * CONSTANTS.DURACION_JITTER;
  return Math.max(0.25, base * f);
}
window.jitterDuration = jitterDuration;

/** Día del año 1..DIAS_POR_ANIO */
function getDiaDelAnio(t) {
  let horasAnio = CONSTANTS.HORAS_POR_ANIO;
  let dentro = ((t % horasAnio) + horasAnio) % horasAnio;
  return Math.floor(dentro / CONSTANTS.HORAS_POR_DIA) + 1;
}

function getAnio(t) {
  return Math.floor(t / CONSTANTS.HORAS_POR_ANIO) + 1;
}

function esEstacionFria(t) {
  return getDiaDelAnio(t) <= CONSTANTS.DIAS_FRIO_HASTA;
}
window.getDiaDelAnio = getDiaDelAnio;
window.getAnio = getAnio;
window.esEstacionFria = esEstacionFria;
