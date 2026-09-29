// World — el único lugar que conoce entidades y componentes.
//
// Entity = un número (id). No tiene métodos ni sabe qué sistemas la usan.
// Los sistemas preguntan: "quién tiene Position y Velocity?" via query().

export class World {
  constructor({ width, height }) {
    this.width = width;
    this.height = height;

    this._nextId = 0;
    this._freeList = [];
    this._alive = []; // true si el id está vivo
    this._stores = new Set(); // stores registrados al hacer addComponent
    this._systems = [];

    this.lastTime = 0;
    this.deltaTime = 0;
    this._boundLoop = this._loop.bind(this);
  }

  // ── Entidades ──────────────────────────────────────────────────────────

  createEntity() {
    const id =
      this._freeList.length > 0 ? this._freeList.pop() : this._nextId++;
    this._alive[id] = true;
    return id;
  }

  destroyEntity(id) {
    if (!this._alive[id]) return;
    // Sacar todos los componentes de esta entidad
    for (const store of this._stores) {
      store.remove(id);
    }
    this._alive[id] = false;
    this._freeList.push(id);
  }

  // ── Componentes ────────────────────────────────────────────────────────

  addComponent(id, store, data = {}) {
    this._stores.add(store);
    return store.add(id, data);
  }

  removeComponent(id, store) {
    store.remove(id);
  }

  has(id, store) {
    return store.has(id);
  }

  // Devuelve el slot denso en ese store (-1 si no tiene el componente).
  get(id, store) {
    return store.slotOf(id);
  }

  // Query naive: recorrer el primer store y quedarse con los ids
  // que también tienen el resto. Suficiente para enseñar la idea.
  query(...stores) {
    if (stores.length === 0) return [];

    const result = [];
    const first = stores[0];

    for (let slot = 0; slot < first.count; slot++) {
      const id = first._entity[slot];
      let ok = true;
      for (let i = 1; i < stores.length; i++) {
        if (!stores[i].has(id)) {
          ok = false;
          break;
        }
      }
      if (ok) result.push(id);
    }
    return result;
  }

  // ── Sistemas y loop ────────────────────────────────────────────────────

  addSystem(system) {
    this._systems.push(system);
  }

  update(dt) {
    const systems = this._systems;
    for (let i = 0; i < systems.length; i++) {
      systems[i](this, dt);
    }
  }

  _loop(now) {
    this.deltaTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this.update(this.deltaTime);
    requestAnimationFrame(this._boundLoop);
  }

  start() {
    this.lastTime = performance.now();
    requestAnimationFrame(this._boundLoop);
  }
}
