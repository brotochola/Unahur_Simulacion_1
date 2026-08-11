class EventSystem {
  constructor() {
    this.afinidades = new Map(); // key 'idA-idB' -> valor 0-100
  }

  keyFor(a, b) {
    return a < b ? a + '-' + b : b + '-' + a;
  }

  getAfinidad(a, b) {
    let k = this.keyFor(a, b);
    return this.afinidades.has(k) ? this.afinidades.get(k) : 50;
  }

  adjustAfinidad(a, b, delta) {
    if (a === b) return;
    let k = this.keyFor(a, b);
    let actual = this.getAfinidad(a, b);
    this.afinidades.set(k, Math.max(0, Math.min(100, actual + delta)));
  }

  scheduleNextRandomEvent() {
    // Media de 1 evento cada 50 horas (tasa = 0.02)
    let delay = Math.round(window.RNG.nextExponential(0.02));
    if (delay < 1) delay = 1;
    window.Sim.scheduleEvent(new RandomEvent(window.Sim.time.hour + delay));
  }

  executeRandomEvent() {
    let vivas = window.Sim.personas.filter(p => p.isAlive());
    if (vivas.length === 0) return;

    let r = window.RNG.next();
    if (r < 0.6) {
      // Descubrimiento de recursos
      window.Sim.inventario.comida += 100;
      window.Sim.addEvent(`La comunidad encontró un gran arbusto frutal. +100 Comida!`, 'ev-bueno', null);
      vivas.forEach(p => p.felicidad = Math.min(100, p.felicidad + 10));
    } else {
      // Noche muy fría o evento menor
      window.Sim.addEvent(`Una fuerte tormenta azotó la aldea.`, 'ev-neutro', null);
      vivas.forEach(p => {
        if (!p.casaId) p.frio = Math.min(100, p.frio + 20);
      });
    }
    
    // Programar el siguiente
    this.scheduleNextRandomEvent();
  }

  tickSocialEvents() {
    let vivas = window.Sim.personas.filter(p => p.isAlive() && p.isAdult());
    
    // Evaluar interacciones y parejas
    for (let i = 0; i < vivas.length; i++) {
      let p1 = vivas[i];
      for (let j = i + 1; j < vivas.length; j++) {
        let p2 = vivas[j];
        if (p1.id === p2.id) continue; // defensa: nunca consigo mismo
        let af = this.getAfinidad(p1.id, p2.id);
        let atraccion1 = p1.getAfractionTo(p2);
        let atraccion2 = p2.getAfractionTo(p1);
        let romanceMult = CONSTANTS.ROMANCE_MULTIPLIER;
        let socialChance = CONSTANTS.SOCIAL_CHANCE;

        // Evolución orgánica de afinidad (socialización aleatoria)
        if (window.RNG.next() < socialChance) {
           // Interacción cotidiana (más chance de ser positiva)
           let delta = window.RNG.next() < 0.7 ? 5 : -2;
           this.adjustAfinidad(p1.id, p2.id, delta);
           af = this.getAfinidad(p1.id, p2.id); // actualizar valor local
        }

        let score = (af * atraccion1 * atraccion2); // 0 a 100 max approx if attraction is 1
        let scoreRomantico = af * Math.max(atraccion1, atraccion2) * romanceMult; // Fórmula más indulgente, afectada por slider

        // Si ya tienen pareja, y son felices, es mucho más difícil que se enamoren o tengan un affair
        if (p1.pareja && p1.pareja !== p2.id) {
           scoreRomantico *= (1.0 - (p1.felicidad / 100) * 0.8); // reduce hasta un 80% si está muy feliz
        }
        if (p2.pareja && p2.pareja !== p1.id) {
           scoreRomantico *= (1.0 - (p2.felicidad / 100) * 0.8);
        }

        if (scoreRomantico > 25 && window.RNG.next() < 0.15 * romanceMult) {
          // Tener sexo — si hay casa, entran y se ocultan en el mapa
          let casaId = p1.casaId || p2.casaId;
          if (casaId) {
            let casa = window.Sim.housing.casas.find(c => c.id === casaId);
            if (casa) {
              p1.x = casa.x; p1.y = casa.y; p1.inHouse = true;
              p2.x = casa.x; p2.y = casa.y; p2.inHouse = true;
              let dur = jitterDuration(1 + window.RNG.next() * 2); // ~1–3h
              window.Sim.scheduleEvent(new LeaveHouseEvent(window.Sim.time.hour + dur, [p1.id, p2.id]));
            }
          }
          window.Sim.addEvent(`${p1.nombre} y ${p2.nombre} tuvieron un encuentro íntimo.`, 'ev-intimo', p1.id);
          p1.felicidad = Math.min(100, p1.felicidad + 20);
          p2.felicidad = Math.min(100, p2.felicidad + 20);
          
          // Riesgo de infidelidad
          if ((p1.pareja && p1.pareja !== p2.id) || (p2.pareja && p2.pareja !== p1.id)) {
            // Drama! (solo si es descubierto, pongamos 50% chance)
            if (window.RNG.next() < 0.5) {
               window.Sim.addEvent(`¡Rumores! La infidelidad de ${p1.nombre} y ${p2.nombre} salió a la luz.`, 'ev-malo', p1.id);
               if (p1.pareja) {
                 let parejaP1 = window.Sim.personas.find(x => x.id === p1.pareja);
                 if (parejaP1) {
                   parejaP1.felicidad = Math.max(0, parejaP1.felicidad - 50);
                   this.adjustAfinidad(parejaP1.id, p1.id, -50);
                 }
               }
               if (p2.pareja) {
                 let parejaP2 = window.Sim.personas.find(x => x.id === p2.pareja);
                 if (parejaP2) {
                   parejaP2.felicidad = Math.max(0, parejaP2.felicidad - 50);
                   this.adjustAfinidad(parejaP2.id, p2.id, -50);
                 }
               }
            }
          } else if (!p1.pareja && !p2.pareja && scoreRomantico > 40 && window.RNG.next() < 0.3) {
            // Formar pareja
            p1.pareja = p2.id;
            p2.pareja = p1.id;
            window.Sim.addEvent(`${p1.nombre} y ${p2.nombre} son ahora pareja oficial.`, 'ev-pareja', p1.id);
          } else if (!p1.pareja && !p2.pareja && scoreRomantico > 30 && window.RNG.next() < 0.2) {
            // Enamoramiento (crush), no son pareja todavía pero sienten cosas fuertes
            if (atraccion1 > atraccion2) {
               window.Sim.addEvent(`¡${p1.nombre} se enamoró de ${p2.nombre}!`, 'ev-amor', p1.id);
            } else {
               window.Sim.addEvent(`¡${p2.nombre} se enamoró de ${p1.nombre}!`, 'ev-amor', p2.id);
            }
          }

          // Embarazo? (Solo Femenino puede gestar en este modelo simple)
          if (p1.sexo === 'F' && p2.sexo === 'M' && !p1.embarazoHorasRestantes && window.RNG.next() < CONSTANTS.PROB_CONCEPCION) {
            p1.embarazoHorasRestantes = CONSTANTS.HORAS_EMBARAZO;
            window.Sim.addEvent(`${p1.nombre} ha quedado embarazada.`, 'ev-nacimiento', p1.id);
          }
          if (p2.sexo === 'F' && p1.sexo === 'M' && !p2.embarazoHorasRestantes && window.RNG.next() < CONSTANTS.PROB_CONCEPCION) {
            p2.embarazoHorasRestantes = CONSTANTS.HORAS_EMBARAZO;
            window.Sim.addEvent(`${p2.nombre} ha quedado embarazada.`, 'ev-nacimiento', p2.id);
          }
        }
      }
    }
  }

  avanzarEmbarazos() {
    let vivas = window.Sim.personas.filter(p => p.isAlive() && p.embarazoHorasRestantes !== null);
    vivas.forEach(p => {
      p.embarazoHorasRestantes -= 12; // El chequeo se corre cada 12 horas
      if (p.embarazoHorasRestantes <= 0) {
        p.embarazoHorasRestantes = null;
        let sexo = window.RNG.next() < 0.5 ? 'M' : 'F';
        let name = pickUniqueName(sexo);
        
        // Tratamos al parejo como padre a los fines de la familia (o podríamos registrar el padre real si quisieramos)
        let padres = [p.id];
        if (p.pareja) padres.push(p.pareja);

        let bebe = new Person(name, sexo, 0, padres);
        // Bebe nace en la posicion de la madre
        bebe.x = p.x;
        bebe.y = p.y;
        bebe.casaId = p.casaId;

        window.Sim.personas.push(bebe);
        p.hijos.push(bebe.id);
        if (p.pareja) {
          let pareja = window.Sim.personas.find(x => x.id === p.pareja);
          if (pareja) pareja.hijos.push(bebe.id);
        }

        window.Sim.addEvent(`¡Ha nacido ${bebe.nombre}, hijo/a de ${p.nombre}!`, 'ev-nacimiento', p.id);
      }
    });
  }
}

window.EventSystem = EventSystem;
