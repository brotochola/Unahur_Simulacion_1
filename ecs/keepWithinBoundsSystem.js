import { UpdateSystem } from "./updateSystem.js";
import { World } from "./world.js";

export class KeepWithinBoundsSystem extends UpdateSystem {
  static targets = [];

  static updatePool(pool) {
    const { width, height } = World.instance;
    const left = 0;
    const top = 0;
    const right = width;
    const bottom = height;

    const { x, y, vx, vy, _activeCount } = pool;

    for (let j = 0; j < _activeCount; j++) {
      if (x[j] < left) {
        x[j] = left;
        vx[j] = -vx[j];
      } else if (x[j] > right) {
        x[j] = right;
        vx[j] = -vx[j];
      }

      if (y[j] < top) {
        y[j] = top;
        vy[j] = -vy[j];
      } else if (y[j] > bottom) {
        y[j] = bottom;
        vy[j] = -vy[j];
      }
    }
  }
}
