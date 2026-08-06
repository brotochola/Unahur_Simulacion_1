let houseNextId = 1;

class HousingSystem {
  constructor() {
    this.casas = []; // { id, x, y, duenos: [idPerson1, idPerson2] }
  }

  crearCasa(x, y, builderId) {
    let casa = {
      id: houseNextId++,
      x: x,
      y: y,
      duenos: [builderId]
    };
    this.casas.push(casa);
    return casa.id;
  }

  getCasaOf(personId) {
    return this.casas.find(c => c.duenos.includes(personId));
  }

  getHabitantes(casa) {
    // Retorna los dueños adultos + hijos menores de edad de los dueños
    let habitantes = [...casa.duenos];
    for (let duenoId of casa.duenos) {
      let p = window.Sim.personas.find(per => per.id === duenoId);
      if (p) {
        for (let hijoId of p.hijos) {
          let hijo = window.Sim.personas.find(per => per.id === hijoId);
          if (hijo && !hijo.isAdult() && !habitantes.includes(hijoId)) {
            habitantes.push(hijoId);
          }
        }
      }
    }
    return habitantes;
  }

  /** Saca muertos de duenos; libera cupos. */
  limpiarMuertos() {
    for (let casa of this.casas) {
      casa.duenos = casa.duenos.filter(id => {
        let p = window.Sim.personas.find(x => x.id === id);
        return p && p.isAlive();
      });
    }
  }

  alMorir(person) {
    let casa = this.getCasaOf(person.id);
    if (casa) {
      casa.duenos = casa.duenos.filter(id => id !== person.id);
    }
    person.casaId = null;
  }

  /**
   * Adulto debe ser dueño (dueno) o sin casa.
   * Hijo que cumple 18: sale de casa de padres salvo que haya cupo libre (muerte).
   * Luego intenta pareja / casa vacía.
   */
  revisarAdulto(person) {
    if (!person.isAdult() || !person.isAlive()) return;

    this.limpiarMuertos();

    let casa = person.casaId != null
      ? this.casas.find(c => c.id === person.casaId)
      : null;
    let esDueno = casa && casa.duenos.includes(person.id);

    if (esDueno) return; // ya adulto dueño legítimo

    // Tenía casaId de padres (o casa inválida) pero no es dueño
    if (casa && casa.duenos.length < CONSTANTS.MAX_ADULTOS_POR_CASA) {
      // Cupo libre (p.ej. murió un padre): reclama la casa
      casa.duenos.push(person.id);
      person.casaId = casa.id;
      window.Sim.addEvent(`${person.nombre} quedó como adulto en la casa familiar.`);
      return;
    }

    if (person.casaId) {
      person.casaId = null;
      window.Sim.addEvent(`${person.nombre} dejó la casa familiar al hacerse adulto.`);
    }

    this.intentarMudarse(person);
  }

  intentarMudarse(person) {
    if (person.casaId) return; // ya tiene
    if (!person.isAdult()) return;

    this.limpiarMuertos();

    // 1. Pareja con espacio
    if (person.pareja) {
      let pareja = window.Sim.personas.find(p => p.id === person.pareja);
      if (pareja && pareja.casaId) {
        let casa = this.casas.find(c => c.id === pareja.casaId);
        if (casa && casa.duenos.length < CONSTANTS.MAX_ADULTOS_POR_CASA) {
          casa.duenos.push(person.id);
          person.casaId = casa.id;
          window.Sim.addEvent(`${person.nombre} se mudó a la casa de su pareja ${pareja.nombre}.`);
          return;
        }
      }
    }

    // 2. Casa vacía (ambos dueños muertos / abandonada)
    let vacia = this.casas.find(c => c.duenos.length === 0);
    if (vacia) {
      vacia.duenos.push(person.id);
      person.casaId = vacia.id;
      window.Sim.addEvent(`${person.nombre} se mudó a una casa vacía.`);
    }
  }

  /**
   * Habitantes vivos de una casa: dueños + menores con casaId de esa casa.
   */
  getResidentesVivos(casa) {
    let ids = this.getHabitantes(casa);
    // También quien tenga casaId apuntando aquí (hijos)
    for (let p of window.Sim.personas) {
      if (p.isAlive() && p.casaId === casa.id && !ids.includes(p.id)) {
        ids.push(p.id);
      }
    }
    return ids
      .map(id => window.Sim.personas.find(x => x.id === id))
      .filter(p => p && p.isAlive());
  }

  /** Calefacción / frío por estación (tick ~12h). */
  tickClima(sim) {
    let fria = esEstacionFria(sim.time.hour);
    this.limpiarMuertos();

    if (fria) {
      for (let casa of this.casas) {
        let residentes = this.getResidentesVivos(casa);
        if (residentes.length === 0) continue;

        // Reservar MADERA_POR_CASA: si no, calefacción deja stock en 0 y nadie construye
        let puedeQuemar =
          sim.inventario.madera >= CONSTANTS.MADERA_FUEGO_POR_CASA + CONSTANTS.MADERA_POR_CASA;
        if (puedeQuemar) {
          sim.inventario.madera -= CONSTANTS.MADERA_FUEGO_POR_CASA;
          for (let p of residentes) {
            p.frio = Math.max(0, p.frio - 25);
          }
        } else {
          for (let p of residentes) {
            p.frio = Math.min(100, p.frio + 15);
          }
        }
      }

      // Sin casa o afuera (no inHouse): más frío
      for (let p of sim.personas) {
        if (!p.isAlive()) continue;
        if (!p.casaId || !p.inHouse) {
          p.frio = Math.min(100, p.frio + (p.casaId ? 8 : 18));
        }
      }
    } else {
      for (let p of sim.personas) {
        if (!p.isAlive()) continue;
        p.frio = Math.max(0, p.frio - 20);
      }
    }
  }
}

window.HousingSystem = HousingSystem;
