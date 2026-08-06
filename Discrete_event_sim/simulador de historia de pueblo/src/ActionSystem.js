function jitterDurationLocal(base) {
  return typeof jitterDuration === 'function' ? jitterDuration(base) : Math.max(0.25, base);
}

class ActionSystem {
  constructor() {
    this.acciones = {
      viajar: {
        duration: (p, ctx) => jitterDurationLocal(Math.max(1, Math.ceil(ctx.distance / p.velocidad))),
        onStart: (p, ctx) => `${p.nombre} viaja hacia ${ctx.nextAction}.`,
        onComplete: (p, ctx) => {
          // Recursos y construcción: aterrizar en dest exacto (findNearestEmptyTile
          // con 900 personas casi nunca deja el tile de obra elegido).
          const landExact = ['cortar_madera', 'recolectar_comida', 'recolectar_agua', 'cazar', 'construir_casa'].includes(ctx.nextAction);
          if (landExact) {
            p.x = ctx.dest.x;
            p.y = ctx.dest.y;
          } else {
            let finalPos = window.Sim.map.findNearestEmptyTile(ctx.dest.x, ctx.dest.y);
            p.x = finalPos.x;
            p.y = finalPos.y;
          }
          window.Sim.startAction(p, ctx.nextAction, ctx.nextCtx);
          return `${p.nombre} llegó a su destino y comienza a ${ctx.nextAction.replace('_', ' ')}.`;
        }
      },
      dormir: {
        duration: (p) => {
          let hourOfDay = ((window.Sim.time.hour % CONSTANTS.HORAS_POR_DIA) + CONSTANTS.HORAS_POR_DIA) % CONSTANTS.HORAS_POR_DIA;
          let r = (CONSTANTS.HORA_DESPERTAR - hourOfDay + CONSTANTS.HORAS_POR_DIA) % CONSTANTS.HORAS_POR_DIA;
          return r === 0 ? CONSTANTS.HORAS_POR_DIA : r;
        },
        onStart: (p) => {
          if (p.casaId) {
            let casa = window.Sim.housing.casas.find(c => c.id === p.casaId);
            if (casa) {
              p.x = casa.x;
              p.y = casa.y;
              p.inHouse = true;
            }
            return `${p.nombre} se va a dormir.`;
          }
          // Sin casa + invierno: muerte inmediata al echarse afuera
          if (typeof esEstacionFria === 'function' && esEstacionFria(window.Sim.time.hour)) {
            p.estado = 'muerto';
            p.currentAction = null;
            p.inHouse = false;
            window.Sim.housing.alMorir(p);
            window.Sim.addEvent(`${p.nombre} murió de frío al dormir a la intemperie.`, 'ev-muerte', p.id);
            return null;
          }
          return `${p.nombre} se va a dormir.`;
        },
        onComplete: (p) => {
          if (!p.isAlive()) return null;
          p.inHouse = false;
          if (window.Sim.map && !window.Sim.map.isTileEmpty(p.x, p.y)) {
            let finalPos = window.Sim.map.findNearestEmptyTile(p.x, p.y);
            p.x = finalPos.x;
            p.y = finalPos.y;
          }
          p.energia = 100;
          if (p.casaId) {
            p.frio = Math.max(0, p.frio - 40);
          } else {
            p.frio = Math.min(100, p.frio + 15);
            p.felicidad = Math.max(0, p.felicidad - 5);
          }
          return `${p.nombre} se despierta.`;
        }
      },
      recolectar_agua: {
        duration: (p) => jitterDurationLocal(2),
        onStart: (p) => `${p.nombre} extrae agua.`,
        onComplete: (p) => {
          // Llena recipientes hasta capacidad de carga; bebe en la fuente
          p.carga.tipo = 'agua';
          p.carga.cantidad = p.fuerza_carga;
          p.sed = 0;
          let campPos = { x: Math.floor(CONSTANTS.MAP_WIDTH / 2), y: Math.floor(CONSTANTS.MAP_HEIGHT / 2) };
          let dist = Math.abs(campPos.x - p.x) + Math.abs(campPos.y - p.y);
          window.Sim.startAction(p, 'viajar', {
            dest: campPos,
            distance: dist,
            nextAction: 'depositar',
            nextCtx: null
          });
          return `${p.nombre} llenó recipientes (${p.carga.cantidad} L) y vuelve al campamento.`;
        }
      },
      recolectar_comida: {
        duration: (p) => jitterDurationLocal(3),
        onStart: (p) => `${p.nombre} recolecta frutos.`,
        onComplete: (p) => {
          p.carga.tipo = 'comida';
          p.carga.cantidad = p.fuerza_carga;
          p.hambre = 0;
          let campPos = { x: Math.floor(CONSTANTS.MAP_WIDTH / 2), y: Math.floor(CONSTANTS.MAP_HEIGHT / 2) };
          let dist = Math.abs(campPos.x - p.x) + Math.abs(campPos.y - p.y);
          window.Sim.startAction(p, 'viajar', {
            dest: campPos, distance: dist, nextAction: 'depositar', nextCtx: null
          });
          return `${p.nombre} comió frutos y recolectó más.`;
        }
      },
      cortar_madera: {
        duration: (p) => jitterDurationLocal(4),
        onStart: (p) => `${p.nombre} tala árboles.`,
        onComplete: (p) => {
          let tile = window.Sim.map.getTile(p.x, p.y);
          let extraida = 0;

          // Otro llegó antes y ya taló: retarget al bosque más cercano
          if (!tile || tile.type !== 'bosque') {
            let near = window.Sim.map.findNearestTile(p.x, p.y, 'bosque');
            if (near.pos) {
              p.x = near.pos.x;
              p.y = near.pos.y;
              tile = window.Sim.map.getTile(p.x, p.y);
            }
          }

          if (tile && tile.type === 'bosque') {
            extraida = Math.min(p.fuerza_carga, tile.wood || 0);
            p.carga.tipo = 'madera';
            p.carga.cantidad = extraida;
            // Un corte = árbol caído (antes wood=100 y fuerza~10 dejaban el 🌲 casi eterno)
            window.Sim.map.updateTile(p.x, p.y, 'tierra');
          }

          if (extraida > 0) {
            let campPos = { x: Math.floor(CONSTANTS.MAP_WIDTH / 2), y: Math.floor(CONSTANTS.MAP_HEIGHT / 2) };
            let dist = Math.abs(campPos.x - p.x) + Math.abs(campPos.y - p.y);
            window.Sim.startAction(p, 'viajar', {
              dest: campPos, distance: dist, nextAction: 'depositar', nextCtx: null
            });
          }
          return `${p.nombre} consiguió ${extraida} de madera.`;
        }
      },
      cazar: {
        duration: (p, ctx) => jitterDurationLocal(5),
        onStart: (p) => `${p.nombre} está cazando en el bosque.`,
        onComplete: (p, ctx) => {
          let chance = Math.min(0.8, 0.2 + (ctx.densidad * 0.1));
          if (window.RNG.next() < chance) {
            p.carga.tipo = 'comida';
            p.carga.cantidad = CONSTANTS.COMIDA_POR_CAZA_EXITOSA;
            p.hambre = 0;
            let campPos = { x: Math.floor(CONSTANTS.MAP_WIDTH / 2), y: Math.floor(CONSTANTS.MAP_HEIGHT / 2) };
            let dist = Math.abs(campPos.x - p.x) + Math.abs(campPos.y - p.y);
            window.Sim.startAction(p, 'viajar', {
              dest: campPos, distance: dist, nextAction: 'depositar', nextCtx: null
            });
            return `¡Cacería exitosa! ${p.nombre} trajo mucha carne.`;
          } else {
            p.energia = Math.max(0, p.energia - 20);
            return `${p.nombre} intentó cazar pero volvió con las manos vacías.`;
          }
        }
      },
      depositar: {
        duration: (p) => jitterDurationLocal(1),
        onStart: (p) => `${p.nombre} está depositando recursos.`,
        onComplete: (p) => {
          if (p.carga.tipo && p.carga.cantidad > 0) {
            window.Sim.inventario[p.carga.tipo] += p.carga.cantidad;
            let msg = `${p.nombre} depositó ${p.carga.cantidad} de ${p.carga.tipo}.`;
            p.carga.tipo = null;
            p.carga.cantidad = 0;
            return msg;
          }
          return `${p.nombre} no tenía nada que depositar.`;
        }
      },
      comer: {
        duration: (p) => jitterDurationLocal(1),
        onStart: (p) => `${p.nombre} va a comer.`,
        onComplete: (p) => {
          let req = 20;
          if (window.Sim.inventario.comida >= req) {
            window.Sim.inventario.comida -= req;
            p.hambre = Math.max(0, p.hambre - (40 * p.metabolismo));
            p.felicidad = Math.min(100, p.felicidad + 5);
            return `${p.nombre} comió del inventario común.`;
          } else {
            p.felicidad = Math.max(0, p.felicidad - 10);
            return `${p.nombre} intentó comer pero no hay comida.`;
          }
        }
      },
      beber: {
        duration: (p) => jitterDurationLocal(1),
        onStart: (p) => `${p.nombre} va a beber.`,
        onComplete: (p) => {
          let req = p.aguaRequerida();
          if (window.Sim.inventario.agua >= req) {
            window.Sim.inventario.agua -= req;
            p.sed = 0;
            return `${p.nombre} bebió ${req} L del inventario común.`;
          } else {
            p.felicidad = Math.max(0, p.felicidad - 10);
            return `${p.nombre} intentó beber pero no hay agua.`;
          }
        }
      },
      construir_casa: {
        duration: (p, ctx) => jitterDurationLocal(1),
        onStart: (p, ctx) => {
          if ((ctx.progreso || 0) === 0) {
            if (window.Sim.inventario.madera < CONSTANTS.MADERA_POR_CASA) {
              ctx.abort = true;
              return `${p.nombre} no pudo empezar la casa: falta madera.`;
            }
            window.Sim.inventario.madera -= CONSTANTS.MADERA_POR_CASA;
            ctx.maderaCobrada = true;
          }
          return `${p.nombre} trabaja en una casa.`;
        },
        onComplete: (p, ctx) => {
          if (ctx.abort) {
            p.currentAction = null;
            p.estado = 'ocioso';
            window.Sim.scheduleEvent(new DecideActionEvent(window.Sim.time.hour, p.id));
            return null;
          }
          ctx.progreso += 1;
          p.energia -= 5;
          if (ctx.progreso >= CONSTANTS.HORAS_CONSTRUCCION_CASA) {
            // Si otro construyó acá mientras tanto, correr al tile libre más cercano
            let x = p.x, y = p.y;
            let ocupada = window.Sim.housing.casas.some(h => h.x === x && h.y === y);
            if (ocupada) {
              let alt = window.Sim.map.findEmptyCampTile(x, y);
              if (alt) { x = alt.x; y = alt.y; p.x = x; p.y = y; }
            }
            window.Sim.map.updateTile(x, y, 'tierra');
            let houseId = window.Sim.housing.crearCasa(x, y, p.id);
            p.casaId = houseId;
            return `${p.nombre} terminó de construir una casa!`;
          }
          window.Sim.startAction(p, 'construir_casa', ctx);
          return null;
        }
      },
      socializar: {
        duration: (p) => jitterDurationLocal(2),
        onStart: (p) => `${p.nombre} busca compañía.`,
        onComplete: (p) => {
          p.soledad = Math.max(0, p.soledad - 30);
          p.felicidad = Math.min(100, p.felicidad + 10);
          return `${p.nombre} pasó tiempo socializando.`;
        }
      },
      permanecer: {
        duration: (p) => jitterDurationLocal(1),
        onStart: (p) => `${p.nombre} holgazanea.`,
        onComplete: (p) => {
          p.energia = Math.min(100, p.energia + 5);
          return null;
        }
      }
    };
  }
}

window.ActionSystem = ActionSystem;
