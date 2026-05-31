import { RenderQueue } from "./renderQueue.js";

export class HtmlRenderSystem {
  static viewport = null;

  static init(viewport) {
    this.viewport = viewport;
  }

  static get viewportWidth() {
    return this.viewport.clientWidth;
  }

  static get viewportHeight() {
    return this.viewport.clientHeight;
  }

  static registerPool(pool) {
    const capacity = pool._capacity;
    const els = new Array(capacity);
    const viewport = this.viewport;

    for (let i = 0; i < capacity; i++) {
      const el = document.createElement("div");
      el.className = "sprite";
      el.style.visibility = "hidden";
      viewport.appendChild(el);
      els[i] = el;
    }

    pool._els = els;
  }

  static draw() {
    const pools = RenderQueue.pools;
    const { count, order, poolId, index } = RenderQueue;

    for (let p = 0; p < pools.length; p++) {
      const pool = pools[p];
      const els = pool._els;
      const activeCount = pool._activeCount;

      for (let j = 0; j < activeCount; j++) {
        els[j].style.visibility = "hidden";
      }
    }

    for (let k = 0; k < count; k++) {
      const i = order[k];
      const pool = pools[poolId[i]];
      const j = index[i];
      const el = pool._els[j];

      el.style.visibility = "visible";
      el.style.zIndex = k;
      el.style.transform =
        "translate3d(" + pool.x[j] + "px," + pool.y[j] + "px,0)";
    }
  }
}
