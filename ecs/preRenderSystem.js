import { UpdateSystem } from "./updateSystem.js";
import { RenderQueue } from "./renderQueue.js";
import { World } from "./world.js";

export class PreRenderSystem extends UpdateSystem {
  static targets = [];
  static _initialized = false;

  static init(capacity) {
    RenderQueue.init(capacity);
    this._initialized = true;
  }

  static update() {
    const R = World.instance.renderer;
    const left = 0;
    const top = 0;
    const right = R.viewportWidth;
    const bottom = R.viewportHeight;

    const targets = this.targets;
    const { poolId, index, y, order } = RenderQueue;

    let count = 0;

    for (let t = 0; t < targets.length; t++) {
      const pool = targets[t];
      const pid = pool.poolId;
      const xs = pool.x;
      const ys = pool.y;
      const activeCount = pool._activeCount;

      for (let i = 0; i < activeCount; i++) {
        const px = xs[i];
        const py = ys[i];

        if (px < left || px > right || py < top || py > bottom) {
          continue;
        }

        poolId[count] = pid;
        index[count] = i;
        y[count] = py;
        count++;
      }
    }

    RenderQueue.count = count;

    for (let k = 0; k < count; k++) {
      order[k] = k;
    }

    this.sortOrder(count);
  }

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
