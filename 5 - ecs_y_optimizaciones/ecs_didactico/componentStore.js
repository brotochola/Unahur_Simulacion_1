// ComponentStore con arrays JS (crecen solos).
//
// SoA (Structure of Arrays): un array por campo (x[], y[], …), no un objeto
// por entidad. Los sistemas recorren columnas contiguas → mejor localidad de caché.
//
// Array denso: las filas vivas viven en [0 .. count). No hay huecos. Eso se llama
// "denso" frente a un array "sparse" donde el índice = entityId y hay gaps.
//
// Dos índices distintos:
//   entityId  — identidad estable de la entidad (la da el World).
//   slot      — fila densa en ESTE store (0..count-1). Cambia si alguien se borra.
//
// Mapas:
//   _entity[slot] → id     (recorrer el store: for slot in 0..count)
//   _slot[id]     → slot   (lookup O(1) "¿tiene este componente? ¿en qué fila?")
//
// Agregar / sacar un componente es lo que "arma" o "desarma" una entidad.
// No hay lógica de juego acá: solo datos + estos mapas.

export class ComponentStore {
  constructor(fields) {
    this._fields = fields;
    this._entity = []; // slot → entityId
    this._slot = []; // entityId → slot (o -1 / undefined = no tiene el componente)
    this.count = 0; // cuántas filas vivas; la zona densa es [0 .. count)

    for (let i = 0; i < fields.length; i++) {
      this[fields[i]] = [];
    }
  }

  has(id) {
    const s = this._slot[id];
    return s !== undefined && s >= 0;
  }

  // Slot denso = índice en la zona compacta [0 .. count).
  // Los sistemas leen Position.x[slot], no Position.x[entityId].
  // Si la entidad no tiene este componente → -1.
  slotOf(id) {
    const s = this._slot[id];
    return s === undefined ? -1 : s;
  }

  // Append al final de la zona densa: el nuevo ocupa el slot = count.
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

  // Swap-and-pop — borrar en O(1) sin dejar huecos:
  //
  //   1. Copiar la ÚLTIMA fila viva sobre la fila que se va (el "swap").
  //   2. Bajar count (el "pop": esa última fila ya no cuenta como viva).
  //   3. Actualizar _slot del id que se movió y marcar el borrado con -1.
  //
  // Ejemplo: borrar el de slot 1 (id=B), con count=4:
  //
  //   antes:  slot  0    1    2    3     count=4
  //           ids   A    B    C    D
  //
  //   después: slot  0    1    2         count=3
  //            ids   A    D    C          (D pisó a B)
  //
  // Trade-off: el orden de las filas NO se conserva. A cambio, remove es O(1)
  // y el array sigue denso (los bucles no tienen que saltar huecos).
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
