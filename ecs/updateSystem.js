class UpdateSystem {
  static targets = [];
  static _registered = false;

  // Outer loop compartido — subclases sobreescriben updatePool, no este método.
  // "this" es la subclase gracias a la herencia estática de JS,
  // por lo que this.updatePool resuelve al override correcto sin overhead.
  static update(dt) {
    const targets = this.targets;
    for (let i = 0; i < targets.length; i++) {
      this.updatePool(targets[i], dt);
    }
  }

  // Hook a sobreescribir en cada sistema concreto.
  static updatePool(pool, dt) {}
}
