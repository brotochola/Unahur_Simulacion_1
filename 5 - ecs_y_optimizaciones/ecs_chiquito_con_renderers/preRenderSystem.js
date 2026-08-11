import { UpdateSystem } from "./updateSystem.js";
import { RenderQueue } from "./renderQueue.js";
import { World } from "./world.js";

// Sistema de pre-renderizado: construye la RenderQueue cada frame.
//
// Hace dos cosas antes de que el renderer dibuje:
//   1. CULLING — descarta entidades fuera del viewport (no vale la pena dibujarlas)
//   2. Y-SORT  — ordena las entidades visibles por su coordenada Y
//
// El Y-sort sirve para simular profundidad en 2D: lo que está más abajo
// en pantalla (Y mayor) se dibuja después, tapando a lo que está arriba.
//
// Este sistema sobreescribe update() completo (en vez de updatePool)
// porque necesita una sola pasada unificada sobre todos los pools,
// no una pasada separada por pool.
export class PreRenderSystem extends UpdateSystem {
  static targets = [];
  static _initialized = false;

  static init(capacity) {
    RenderQueue.init(capacity);
    this._initialized = true;
  }

  static update() {
    // Límites del viewport — se leen del renderer activo cada frame
    const R = World.instance.renderer;
    const left = 0;
    const top = 0;
    const right = R.viewportWidth;
    const bottom = R.viewportHeight;

    const targets = this.targets;
    const { poolId, index, y, order } = RenderQueue;

    let count = 0;

    // Pasada de culling: recorre todos los pools y descarta lo que está fuera
    for (let t = 0; t < targets.length; t++) {
      const pool = targets[t];
      const pid = pool.poolId;
      const xs = pool.x;
      const ys = pool.y;
      const activeCount = pool._activeCount;

      for (let i = 0; i < activeCount; i++) {
        const px = xs[i];
        const py = ys[i];

        // Culling AABB simple: si está fuera del viewport, lo saltamos
        if (px < left || px > right || py < top || py > bottom) {
          continue;
        }

        // Agregar a la cola
        poolId[count] = pid;
        index[count] = i;
        y[count] = py;
        count++;
      }
    }

    RenderQueue.count = count;

    // Inicializar el array de orden (sort indirecto: no movemos poolId/index/y)
    for (let k = 0; k < count; k++) {
      order[k] = k;
    }

    this.sortOrder(count);
  }

  // Insertion sort estable en order[0..count) ordenado por y[].
  //
  // ¿Por qué insertion sort?
  //   - Es estable (mismo Y → mismo orden de frame a frame, sin flickering)
  //   - Zero-alloc: opera in-place sobre order[], sin crear arrays temporales
  //   - Para N pequeño (<1000 entidades visibles) es competitivo con quicksort
  //
  // Tie-break por índice para garantizar orden determinístico cuando dos
  // entidades tienen el mismo Y.
  static sortOrder(count) {
    const order = RenderQueue.order;
    const yArr = RenderQueue.y;

    for (let i = 1; i < count; i++) {
      const key = order[i];
      const keyY = yArr[key];
      let j = i - 1;

      while (
        j >= 0 &&
        (yArr[order[j]] > keyY ||
          (yArr[order[j]] === keyY && order[j] > key))
      ) {
        order[j + 1] = order[j];
        j--;
      }

      order[j + 1] = key;
    }
  }
}
