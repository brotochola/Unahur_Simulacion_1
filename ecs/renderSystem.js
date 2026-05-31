class RenderSystem {
  static canvas = null;
  static ctx = null;

  static init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.fillStyle = "#e94560";
  }

  static draw() {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const { count, order, poolId, index, pools } = RenderQueue;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let k = 0; k < count; k++) {
      const i = order[k];
      const pool = pools[poolId[i]];
      const j = index[i];

      ctx.fillRect(pool.x[j] - 2, pool.y[j] - 2, 4, 4);
    }
  }
}
