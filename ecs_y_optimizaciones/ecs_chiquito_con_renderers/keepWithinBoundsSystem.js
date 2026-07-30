import { UpdateSystem } from "./updateSystem.js";
import { World } from "./world.js";

// Sistema de bordes: mantiene las entidades dentro del mundo invirtiendo su velocidad.
//
// Cada vez que una entidad cruza un borde, se corrige su posición al límite
// y se invierte la componente de velocidad correspondiente (rebote elástico).
// Los límites se leen de World.instance en cada frame, por lo que si el mundo
// cambia de tamaño en runtime, el sistema se adapta automáticamente.
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
      // Rebote horizontal
      if (x[j] < left) {
        x[j] = left;
        vx[j] = -vx[j];
      } else if (x[j] > right) {
        x[j] = right;
        vx[j] = -vx[j];
      }

      // Rebote vertical
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
