// Sistema base del que heredan todos los sistemas concretos.
//
// Usa herencia estática de JS: cuando PhysicsSystem llama this.updatePool(),
// "this" es PhysicsSystem, no UpdateSystem. Esto permite que cada subclase
// sobreescriba solo el método que le corresponde sin duplicar el loop externo.
export class UpdateSystem {
  // Lista de pools que este sistema debe procesar.
  // Cada subclase declara su propio targets = [] para no compartirlo con la base.
  static targets = [];
  static _registered = false;

  // Loop externo compartido: itera sobre todos los pools registrados.
  // Las subclases NO sobreescriben este método, sino updatePool().
  static update(dt) {
    const targets = this.targets;
    for (let i = 0; i < targets.length; i++) {
      this.updatePool(targets[i], dt);
    }
  }

  // Hook que cada sistema concreto implementa.
  // Recibe un pool (clase de entidad) y el deltaTime del frame.
  static updatePool(pool, dt) {}
}
