import { UpdateSystem } from "./updateSystem.js";

export class PhysicsSystem extends UpdateSystem {
  static targets = [];

  static updatePool(pool, dt) {
    const { x, y, vx, vy, _activeCount } = pool;
    for (let j = 0; j < _activeCount; j++) {
      x[j] += vx[j] * dt;
      y[j] += vy[j] * dt;
    }
  }
}
