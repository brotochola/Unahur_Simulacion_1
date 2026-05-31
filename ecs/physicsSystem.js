class PhysicsSystem extends UpdateSystem {
  // ============================================================
  // Pools registrados que este sistema procesa.
  // Se declara propio para no compartir el array con UpdateSystem.
  // ============================================================
  static targets = [];

  // ============================================================
  // Hot loop — iteración LINEAL sobre datos compactos (SoA).
  //
  // Cada pool garantiza que [0, _activeCount) está siempre
  // compacto → stride-1, cache-friendly, SIMD-friendly.
  // ============================================================
  static updatePool(pool, dt) {
    const { x, y, vx, vy, _activeCount } = pool;
    for (let j = 0; j < _activeCount; j++) {
      x[j] += vx[j] * dt;
      y[j] += vy[j] * dt;
    }
  }
}
