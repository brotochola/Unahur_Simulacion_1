class SimEvent {
  constructor(time) {
    this.time = time;
    this.name = 'Generic Event';
  }

  execute(sim) {
    throw new Error("Debe implementarse en la clase hija");
  }
}

class DecideActionEvent extends SimEvent {
  constructor(time, personId) {
    super(time);
    this.name = 'DecideAction';
    this.personId = personId;
  }

  execute(sim) {
    let p = sim.personas.find(x => x.id === this.personId);
    if (p && p.isAlive() && p.isFree()) {
       let decision = sim.decideNextAction(p);
       sim.startAction(p, decision.type, decision);
    }
  }
}

class ActionCompleteEvent extends SimEvent {
  constructor(time, personId, actionType, ctx) {
    super(time);
    this.name = 'ActionComplete';
    this.personId = personId;
    this.actionType = actionType;
    this.ctx = ctx;
  }

  execute(sim) {
    let p = sim.personas.find(x => x.id === this.personId);
    if (p && p.isAlive() && p.currentAction) {
       let def = sim.actionSystem.acciones[this.actionType];
       let prevAction = p.currentAction;
       let msg = def.onComplete(p, this.ctx);
       if (msg) sim.addEvent(msg, '', p.id);
       
       if (p.currentAction === prevAction) {
           p.currentAction = null;
           p.estado = 'ocioso';
           sim.scheduleEvent(new DecideActionEvent(sim.time.hour, p.id));
       }
    }
  }
}

class LeaveHouseEvent extends SimEvent {
  constructor(time, personIds) {
    super(time);
    this.name = 'LeaveHouse';
    this.personIds = personIds;
  }

  execute(sim) {
    for (let id of this.personIds) {
      let p = sim.personas.find(x => x.id === id);
      if (p && p.isAlive()) {
        // Solo salir si no sigue dormido (dormir maneja su propio inHouse)
        if (!p.currentAction || p.currentAction.type !== 'dormir') {
          p.inHouse = false;
          if (sim.map && !sim.map.isTileEmpty(p.x, p.y)) {
            let pos = sim.map.findNearestEmptyTile(p.x, p.y);
            p.x = pos.x;
            p.y = pos.y;
          }
        }
      }
    }
  }
}

class RandomEvent extends SimEvent {
  constructor(time) {
    super(time);
    this.name = 'ExecuteRandomEvent';
  }

  execute(sim) {
    sim.events.executeRandomEvent();
  }
}

class SocialCheckEvent extends SimEvent {
  constructor(time) {
    super(time);
    this.name = 'SocialEventCheck';
  }

  execute(sim) {
    sim.events.tickSocialEvents();
    sim.events.avanzarEmbarazos();
    sim.housing.tickClima(sim);
    
    let vivas = sim.personas.filter(p => p.isAlive());
    vivas.forEach(p => {
      if (p.edad > p.lastEdadChecked) {
        p.lastEdadChecked = p.edad;
        // Muerte ~80: riesgo creciente desde 75
        if (p.edad >= 75) {
          let prob = Math.min(0.95, (p.edad - 74) * 0.15);
          if (window.RNG.next() < prob) {
            p.estado = 'muerto';
            p.currentAction = null;
            p.inHouse = false;
            sim.housing.alMorir(p);
            sim.addEvent(`${p.nombre} ha fallecido de vejez a los ${p.edad} años.`, 'ev-muerte', p.id);
            return;
          }
        }
        if (p.edad === CONSTANTS.EDAD_ADULTA) {
          sim.housing.revisarAdulto(p);
        }
      }
    });
    
    sim.scheduleEvent(new SocialCheckEvent(sim.time.hour + CONSTANTS.HORAS_SOCIAL_CHECK));
  }
}

class EcosystemUpdateEvent extends SimEvent {
  constructor(time) {
    super(time);
    this.name = 'EcosystemUpdate';
  }

  execute(sim) {
    sim.map.tickEcosystem();
    sim.scheduleEvent(new EcosystemUpdateEvent(sim.time.hour + CONSTANTS.HORAS_ECOSYSTEM_TICK));
  }
}

window.SimEvent = SimEvent;
window.DecideActionEvent = DecideActionEvent;
window.ActionCompleteEvent = ActionCompleteEvent;
window.LeaveHouseEvent = LeaveHouseEvent;
window.RandomEvent = RandomEvent;
window.SocialCheckEvent = SocialCheckEvent;
window.EcosystemUpdateEvent = EcosystemUpdateEvent;
