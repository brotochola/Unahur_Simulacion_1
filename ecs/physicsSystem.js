import { UpdateSystem } from "./updateSystem.js";

// Sistema de física: aplica integración de Euler a todas las entidades del pool.
//
// Integración de Euler:
//   posición += velocidad × Δt
//
// Es el método numérico más simple. Cada frame se asume que la velocidad
// es constante durante el intervalo Δt. Para simulaciones simples es suficiente.
export class PhysicsSystem extends UpdateSystem {
  // targets propio para no compartir el array con UpdateSystem
  static targets = [];

  // Hot loop: recorre los arrays SoA de forma lineal (stride-1).
  // Gracias al layout compacto de Fish, no hay huecos ni indirecciones.
  static updatePool(pool, dt) {
    const { x, y, vx, vy, _activeCount } = pool;
    for (let j = 0; j < _activeCount; j++) {
      x[j] += vx[j] * dt;
      y[j] += vy[j] * dt;
    }
  }
}
