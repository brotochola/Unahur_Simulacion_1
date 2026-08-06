function formatSimTime(t) {
  let year = getAnio(t);
  let day = getDiaDelAnio(t);
  let hourFrac = ((t % CONSTANTS.HORAS_POR_DIA) + CONSTANTS.HORAS_POR_DIA) % CONSTANTS.HORAS_POR_DIA;
  let h = Math.floor(hourFrac);
  let minFrac = (hourFrac - h) * 60;
  let m = Math.floor(minFrac);
  let s = Math.floor((minFrac - m) * 60);
  let hh = String(h).padStart(2, '0');
  let mm = String(m).padStart(2, '0');
  let ss = String(s).padStart(2, '0');
  return `Año ${year} · Día ${day} · ${hh}:${mm}:${ss}`;
}
window.formatSimTime = formatSimTime;

class Simulation {
  constructor() {
    this.time = { hour: 0 };
    this.personas = [];
    this.inventario = { comida: 100, agua: 100, madera: 0, piedra: 0 };
    
    this.log = [];
    this.map = new SimulationMap('map-container');
    this.housing = new HousingSystem();
    this.actionSystem = new ActionSystem();
    this.events = new EventSystem();

    this._eventSeq = 0;
    this.eventQueue = new MinHeap((a, b) => {
      let d = a.time - b.time;
      return d !== 0 ? d : a.seq - b.seq;
    });
    this.onUpdate = null; // Callback para la UI
    this.updateFreq = 1; // Actualizar UI cada X eventos procesados
    this.eventsProcessed = 0;
    
    // Políticas de la comunidad (controlables desde UI)
    this.policies = { minComida: 50, minAgua: 50, minMadera: 10 };
    // true = solo reloj/inventario/demografía (sin mapa ni log)
    this.uiStatsOnly = false;
  }

  scheduleEvent(ev) {
    ev.seq = this._eventSeq++;
    this.eventQueue.push(ev);
  }

  init(initialCount = 8) {
    let cx = Math.floor(CONSTANTS.MAP_WIDTH / 2);
    let cy = Math.floor(CONSTANTS.MAP_HEIGHT / 2);

    // Generar 4 casas iniciales (distancia 2 entre sí)
    let posicionesCasas = [
      {x: cx, y: cy - 2},
      {x: cx, y: cy + 2},
      {x: cx - 2, y: cy},
      {x: cx + 2, y: cy}
    ];

    for (let i = 0; i < 4; i++) {
       let casa = { id: i + 1, x: posicionesCasas[i].x, y: posicionesCasas[i].y, duenos: [] };
       this.housing.casas.push(casa);
    }
    // Sincronizar ID de casas por si se construyen más luego
    if (typeof houseNextId !== 'undefined') houseNextId = 5; 

    // Generar pobladores y emparejarlos en las casas si hay disponibles
    for (let i = 0; i < initialCount; i++) {
      let sexo = window.RNG.next() < 0.5 ? 'M' : 'F';
      let name = pickUniqueName(sexo);
      let p = new Person(name, sexo, 20 + Math.floor(window.RNG.next() * 10));
      this.personas.push(p); // temprano para que pickUniqueName vea el nombre
      
      // Intentar asignar 2 a cada casa generada
      let casaIndex = Math.floor(i / 2);
      let casaAsignada = this.housing.casas[casaIndex];
      
      if (casaAsignada) {
        p.casaId = casaAsignada.id;
        // Situar al poblador en una celda vacía cercana a la casa
        let tilePos = this.map.findNearestEmptyTile(casaAsignada.x, casaAsignada.y);
        p.x = tilePos.x;
        p.y = tilePos.y;
        casaAsignada.duenos.push(p.id);
      } else {
        // Si no hay más casas pre-generadas, empiezan sin casa
        let tilePos = this.map.findNearestEmptyTile(cx, cy);
        p.x = tilePos.x;
        p.y = tilePos.y;
      }
    }

    // Programar eventos iniciales
    this.scheduleEvent(new SocialCheckEvent(this.time.hour + CONSTANTS.HORAS_SOCIAL_CHECK));
    this.scheduleEvent(new EcosystemUpdateEvent(this.time.hour + CONSTANTS.HORAS_ECOSYSTEM_TICK));
    this.events.scheduleNextRandomEvent();

    for (let p of this.personas) {
      this.scheduleEvent(new DecideActionEvent(this.time.hour, p.id));
    }
  }

  addEvent(msg, cls = '', personId = null) {
    let t = this.time.hour;
    let seq = this._eventSeq; // mirror current seq for log ordering ties
    let text = `${formatSimTime(t)} — ${msg}`;
    let eventObj = { t, seq, text, cls, personId };
    
    this.log.push(eventObj);
    if (this.log.length > 200) this.log.shift();
    
    if (personId) {
      let p = this.personas.find(x => x.id === personId);
      if (p) {
        if (!p.eventLog) p.eventLog = [];
        p.eventLog.push(eventObj);
        if (p.eventLog.length > 50) p.eventLog.shift();
      }
    }
  }

  startAction(person, actionType, ctx = {}) {
    let def = this.actionSystem.acciones[actionType];
    if (!def) return;
    
    let duration = def.duration(person, ctx);
    person.currentAction = { type: actionType, ctx };
    person.estado = 'ocupado';
    
    let msg = def.onStart(person, ctx);
    if (msg) this.addEvent(msg, '', person.id);

    // En lugar de guardar 'hoursRemaining', encolamos un evento en el futuro
    this.scheduleEvent(new ActionCompleteEvent(this.time.hour + duration, person.id, actionType, ctx));
  }

  decideNextAction(p) {
    let et = p.getEtapa();
    let aguaReq = p.aguaRequerida();

    // Bebés no recolectan; sí beben del stock si hay
    if (et === 'bebe') {
      if (p.sed >= CONSTANTS.THRESH_SED_CRITICA && this.inventario.agua >= aguaReq) return { type: 'beber' };
      return { type: 'permanecer' };
    }

    // Salir de casa familiar / mudarse antes de survival: si no, hambruna
    // masiva nunca libera cupos y nadie construye.
    if (p.isAdult()) this.housing.revisarAdulto(p);

    // 1. Sed crítica: beber del stock SI alcanza la ración; si no, ir a buscar agua
    // (antes: agua > 0 → beber, pero beber pedía 10 → loop infinito con stock 1–9)
    if (p.sed >= CONSTANTS.THRESH_SED_CRITICA) {
      if (this.inventario.agua >= aguaReq) return { type: 'beber' };
      let agua = this.map.findNearestTile(p.x, p.y, 'agua');
      if (agua.pos) return { type: 'viajar', dest: agua.pos, distance: agua.distance, nextAction: 'recolectar_agua' };
    }

    // 2. Adulto sin casa: cobijo antes que hambre.
    // En invierno dormir afuera = muerte; si hay madera/bosque, seguir aunque exhausto.
    if (!p.casaId && p.isAdult()) {
      let fria = typeof esEstacionFria === 'function' && esEstacionFria(this.time.hour);
      if (p.energia <= CONSTANTS.THRESH_ENERGIA_BAJA && !fria) return { type: 'dormir' };
      if (this.inventario.madera >= CONSTANTS.MADERA_POR_CASA) {
        let tile = this.map.findEmptyCampTile(p.x, p.y);
        if (!tile) {
          let cx = Math.floor(CONSTANTS.MAP_WIDTH / 2);
          let cy = Math.floor(CONSTANTS.MAP_HEIGHT / 2);
          let fallback = this.map.findNearestEmptyTile(cx, cy);
          tile = { x: fallback.x, y: fallback.y, distance: Math.abs(p.x - fallback.x) + Math.abs(p.y - fallback.y) };
        }
        return {
          type: 'viajar',
          dest: { x: tile.x, y: tile.y },
          distance: tile.distance,
          nextAction: 'construir_casa',
          nextCtx: { progreso: 0 }
        };
      }
      let bosqueMadera = this.map.findNearestTile(p.x, p.y, 'bosque');
      if (bosqueMadera.pos) {
        return { type: 'viajar', dest: bosqueMadera.pos, distance: bosqueMadera.distance, nextAction: 'cortar_madera' };
      }
      // Sin cobijo posible: si exhausto (o invierno sin bosque), dormir → muerte en frío
      if (p.energia <= CONSTANTS.THRESH_ENERGIA_BAJA || fria) return { type: 'dormir' };
    }

    // 3. Hambre / energía (quien ya tiene casa, o homeless sin bosque reachable)
    if (p.hambre >= CONSTANTS.THRESH_HAMBRE_CRITICA && this.inventario.comida > 0) return { type: 'comer' };
    if (p.energia <= CONSTANTS.THRESH_ENERGIA_BAJA) return { type: 'dormir' };

    if (p.hambre >= CONSTANTS.THRESH_HAMBRE_CRITICA && this.inventario.comida <= 0) {
      let bosque = this.map.findNearestTile(p.x, p.y, 'bosque');
      if (bosque.pos) return { type: 'viajar', dest: bosque.pos, distance: bosque.distance, nextAction: 'recolectar_comida' };
    }

    if (p.soledad >= CONSTANTS.THRESH_SOLEDAD_CRITICA) return { type: 'socializar' };

    // 4. Políticas de stock
    if (this.inventario.comida < this.policies.minComida) {
       // Si hay muchos árboles cerca, conviene cazar, si no, recolectar comida de los árboles.
       let densidadBosque = this.map.countTilesInRadius(p.x, p.y, 4, 'bosque');
       if (densidadBosque >= 3 && window.RNG.next() < 0.5) {
         let bosque = this.map.findNearestTile(p.x, p.y, 'bosque');
         if (bosque.pos) return { type: 'viajar', dest: bosque.pos, distance: bosque.distance, nextAction: 'cazar', nextCtx: { densidad: densidadBosque } };
       } else {
         let bosque = this.map.findNearestTile(p.x, p.y, 'bosque');
         if (bosque.pos) return { type: 'viajar', dest: bosque.pos, distance: bosque.distance, nextAction: 'recolectar_comida' };
       }
    }
    if (this.inventario.agua < this.policies.minAgua) {
       let agua = this.map.findNearestTile(p.x, p.y, 'agua');
       if (agua.pos) return { type: 'viajar', dest: agua.pos, distance: agua.distance, nextAction: 'recolectar_agua' };
    }
    if (this.inventario.madera < this.policies.minMadera) {
       let bosque = this.map.findNearestTile(p.x, p.y, 'bosque');
       if (bosque.pos) return { type: 'viajar', dest: bosque.pos, distance: bosque.distance, nextAction: 'cortar_madera' };
    }

    let opts = ['permanecer', 'socializar'];
    return { type: opts[Math.floor(window.RNG.next() * opts.length)] };
  }

  step() {
    let ev = this.eventQueue.pop();
    if (!ev) return false;

    // MAGIA DEL DES: El reloj salta instantáneamente al momento del próximo evento
    this.time.hour = ev.time;

    // Procesar evento según su clase
    ev.execute(this);

    this.eventsProcessed++;
    if (this.onUpdate && this.eventsProcessed % this.updateFreq === 0) {
      if (!this.uiStatsOnly) {
        this.personas.forEach(p => p.updateStats(this.time.hour));
        let vivas = this.personas.filter(p => p.isAlive());
        vivas.forEach(p => this.map.updatePersonPosition(p));
        this.map.updateHouses(this.housing.casas);
      }
      this.onUpdate();
    }

    return true; // Hay mas eventos
  }
}

window.Simulation = Simulation;
