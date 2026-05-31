class KeepWithinBoundsSystem extends UpdateSystem {
  static targets = [];

  static left = 0;
  static right = 0;
  static top = 0;
  static bottom = 0;

  static updatePool(pool) {
    const { x, y, vx, vy, _activeCount } = pool;
    const left = this.left;
    const right = this.right;
    const top = this.top;
    const bottom = this.bottom;

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
