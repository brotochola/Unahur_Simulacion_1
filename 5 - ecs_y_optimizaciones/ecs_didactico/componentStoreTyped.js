// ComponentStore con TypedArrays — misma API / mismos algoritmos que componentStore.js.
//
// SoA (Structure of Arrays): un TypedArray por campo (x, y, …).
// Array denso: filas vivas en [0 .. count), sin huecos. entityId ≠ slot
//   (el id es estable; el slot es la fila y puede cambiar en un remove).
// Mapas: _entity[slot]→id , _slot[id]→slot  (lookup O(1)).
//
// Diferencia vs arrays JS: acá la capacity es FIJA (una alocación en el ctor).
// No hay grow. Si add() se pasa del techo (filas o ids), return -1.
// Float32Array = datos; Int32Array = mapas (hace falta -1 de "sin componente").

export class ComponentStore {
  constructor(fields, capacity = 1024) {
    this._fields = fields;
    this._capacity = capacity;
    this._entity = new Int32Array(capacity); // slot → entityId
    this._slot = new Int32Array(capacity).fill(-1); // entityId → slot (-1 = ausente)
    this.count = 0; // zona densa = [0 .. count)

    for (let i = 0; i < fields.length; i++) {
      this[fields[i]] = new Float32Array(capacity);
    }
  }

  has(id) {
    if (id < 0 || id >= this._capacity) return false;
    return this._slot[id] >= 0;
  }

  // Slot denso = índice en [0 .. count). Los sistemas leen Store.campo[slot].
  // -1 si la entidad no tiene este componente (o el id está fuera de capacity).
  slotOf(id) {
    if (id < 0 || id >= this._capacity) return -1;
    return this._slot[id];
  }

  // Append al final de la zona densa (slot = count), si hay lugar.
  add(id, data) {
    if (id < 0 || id >= this._capacity) return -1;
    if (this.has(id)) return this.slotOf(id);
    if (this.count >= this._capacity) return -1;

    const slot = this.count++;
    this._entity[slot] = id;
    this._slot[id] = slot;

    for (let i = 0; i < this._fields.length; i++) {
      const f = this._fields[i];
      this[f][slot] = data[f] ?? 0;
    }
    return slot;
  }

  // Swap-and-pop — borrar en O(1) sin dejar huecos:
  //   copiar la última fila viva sobre la que se va, bajar count, actualizar mapas.
  // El orden de filas NO se conserva; a cambio el array sigue denso.
  // (Mismo algoritmo que componentStore.js; ver el ejemplo dibujado allá.)
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
