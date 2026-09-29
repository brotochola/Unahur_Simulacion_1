// Componentes = stores de datos (SoA).
//
// No hay lógica de juego acá. Solo arrays + el mapa id ↔ fila.
// Agregar / sacar un componente es lo que "arma" una entidad.

export class ComponentStore {
  constructor(fields) {
    this._fields = fields;
    this._entity = []; // slot → entityId
    this._slot = []; // entityId → slot (o -1)
    this.count = 0;

    for (let i = 0; i < fields.length; i++) {
      this[fields[i]] = [];
    }
  }

  has(id) {
    const s = this._slot[id];
    return s !== undefined && s >= 0;
  }

  // Devuelve el slot denso, o -1 si no tiene este componente.
  slotOf(id) {
    const s = this._slot[id];
    return s === undefined ? -1 : s;
  }

  add(id, data) {
    if (this.has(id)) return this.slotOf(id);

    const slot = this.count++;
    this._entity[slot] = id;
    this._slot[id] = slot;

    for (let i = 0; i < this._fields.length; i++) {
      const f = this._fields[i];
      this[f][slot] = data[f] ?? 0;
    }
    return slot;
  }

  // Swap-and-pop: la última fila viva pisa a la que se va.
  remove(id) {
    const slot = this.slotOf(id);
    if (slot < 0) return;

    const last = --this.count;
    const movedId = this._entity[last];

    for (let i = 0; i < this._fields.length; i++) {
      const f = this._fields[i];
      this[f][slot] = this[f][last];
    }
    this._entity[slot] = movedId;
    this._slot[movedId] = slot;
    this._slot[id] = -1;
  }
}

export const Position = new ComponentStore(["x", "y"]);
export const Velocity = new ComponentStore(["vx", "vy"]);
