let personNextId = 1;

class Person {
  constructor(nombre, sexo, edad, padres = []) {
    this.id = personNextId++;
    this.nombre = nombre;
    this.sexo = sexo; // 'M' o 'F'
    this.horasVividasBase = edad * CONSTANTS.HORAS_POR_ANIO;
    this.startHour = window.Sim ? window.Sim.time.hour : 0;
    // Fecha de nacimiento absoluta (hora sim)
    this.nacimientoHora = this.startHour - this.horasVividasBase;
    this.lastEdadChecked = edad;
    
    // Posición en el mapa (empieza en el centro del campamento base o algo así, por ahora 0,0)
    this.x = Math.floor(CONSTANTS.MAP_WIDTH / 2);
    this.y = Math.floor(CONSTANTS.MAP_HEIGHT / 2);

    // Variables internas para Lazy Evaluation
    this._hambre = edad < 2 ? 10 : 20;
    this._energia = 100;
    this._sed = 10;
    this._soledad = 10;
    this._salud = 100;
    this.frio = 0;
    this.felicidad = 100;
    this.lastUpdateHour = this.startHour;

    // Rasgos Innatos
    this.irascibilidad = window.RNG.next(); // 0 a 1
    this.metabolismo = 0.5 + window.RNG.next(); // Multiplicador de energía recibida de comida
    this.carisma = window.RNG.next(); // Facilidad para generar afinidad
    this.velocidad = 0.8 + (window.RNG.next() * 0.4); // Multiplicador de tiempo de viaje
    this.fuerza_carga = this.sexo === 'M' ? 10 + Math.floor(window.RNG.next() * 10) : 8 + Math.floor(window.RNG.next() * 8);

    // Orientación sexual (0 a 1)
    this.heterosexualidad = window.RNG.next(); 
    this.homosexualidad = window.RNG.next();

    // Estado general
    this.estado = 'ocioso';
    this.currentAction = null;
    this.inHouse = false;
    
    // Inventario personal (ahora todo va al inventario común, 
    // pero pueden cargar cosas temporalmente si están lejos)
    this.carga = {
      tipo: null, // 'madera', 'comida', 'agua'
      cantidad: 0
    };

    // Relaciones / Housing
    this.pareja = null;
    this.padres = padres;
    this.hijos = [];
    this.embarazoHorasRestantes = null;
    this.casaId = null; // ID de la casa a la que pertenece
  }

  // ---- Lazy Evaluation System ----
  updateStats(currentHour) {
    if (this.lastUpdateHour === currentHour) return;
    const delta = currentHour - this.lastUpdateHour;
    if (delta < 0) return; // Time shouldn't go backward, but just in case
    
    let et = this.getEtapa();
    this._hambre = Math.min(100, this._hambre + delta * (et === 'bebe' ? 0.5 : 1));
    // ~1 ración/día: llega a THRESH_SED_CRITICA en ~HORAS_POR_DIA
    this._sed = Math.min(100, this._sed + delta * (CONSTANTS.THRESH_SED_CRITICA / CONSTANTS.HORAS_POR_DIA));
    this._energia = Math.max(0, this._energia - delta * (et === 'bebe' ? 1 : 2));
    this._soledad = Math.min(100, this._soledad + delta * 1);
    this.lastUpdateHour = currentHour;
  }

  get currentTime() {
    return window.Sim ? window.Sim.time.hour : this.startHour;
  }

  get hambre() { this.updateStats(this.currentTime); return this._hambre; }
  set hambre(val) { this.updateStats(this.currentTime); this._hambre = val; }

  get sed() { this.updateStats(this.currentTime); return this._sed; }
  set sed(val) { this.updateStats(this.currentTime); this._sed = val; }

  get energia() { this.updateStats(this.currentTime); return this._energia; }
  set energia(val) { this.updateStats(this.currentTime); this._energia = val; }

  get soledad() { this.updateStats(this.currentTime); return this._soledad; }
  set soledad(val) { this.updateStats(this.currentTime); this._soledad = val; }

  get salud() { this.updateStats(this.currentTime); return this._salud; }
  set salud(val) { this.updateStats(this.currentTime); this._salud = val; }

  get horasVividas() { return this.horasVividasBase + (this.currentTime - this.startHour); }
  get edad() { return Math.floor(this.horasVividas / CONSTANTS.HORAS_POR_ANIO); }
  // --------------------------------

  isAdult() {
    return this.getEtapa() === 'adulto';
  }

  isAlive() {
    return this.estado !== 'muerto';
  }

  isFree() {
    return this.estado === 'ocioso' && !this.currentAction;
  }

  getEtapa() {
    if (this.edad < 2) return 'bebe';
    if (this.edad < 12) return 'nino';
    if (this.edad < 18) return 'adolescente';
    return 'adulto';
  }

  /** Litros que retira del stock comunitario al beber (1 ración/día). */
  aguaRequerida() {
    let et = this.getEtapa();
    return (et === 'bebe' || et === 'nino') ? CONSTANTS.AGUA_DIA_MENOR : CONSTANTS.AGUA_DIA_ADULTO;
  }

  getAfractionTo(otherPerson) {
    // Retorna un multiplicador de atracción de esta persona hacia otherPerson
    if (this.id === otherPerson.id) return 0;
    const sameSex = this.sexo === otherPerson.sexo;
    return sameSex ? this.homosexualidad : this.heterosexualidad;
  }
}

window.Person = Person;
