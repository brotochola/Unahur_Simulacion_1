import { RenderQueue } from "./renderQueue.js";
import { World } from "./world.js";

export class RenderSystem {
  static canvas = null;
  static ctx = null;

  static init(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = World.instance.width;
      this.canvas.height = World.instance.height;
      if (canvas instanceof HTMLElement) {
        canvas.appendChild(this.canvas);
      }
    } else {
      this.canvas = canvas;
    }
    this.ctx = this.canvas.getContext("2d");
    this.ctx.fillStyle = "#e94560";
  }

  static get viewportWidth() {
    return this.canvas.width;
  }

  static get viewportHeight() {
    return this.canvas.height;
  }

  static registerPool() {}

  static draw() {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const { count, order, poolId, index, pools } = RenderQueue;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let k = 0; k < count; k++) {
      const i = order[k];
      const pool = pools[poolId[i]];
      const j = index[i];

      ctx.fillRect(pool.x[j] - 1, pool.y[j] - 1, 2, 2);
    }
  }
}
