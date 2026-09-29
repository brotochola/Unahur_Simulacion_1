import { Position, Velocity } from "./components.js";

// Rebote elástico contra los bordes del mundo.
// Misma query que física: hace falta posición y velocidad.
export function boundsSystem(world) {
  const ids = world.query(Position, Velocity);
  const { width, height } = world;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const p = Position.slotOf(id);
    const v = Velocity.slotOf(id);

    if (Position.x[p] < 0) {
      Position.x[p] = 0;
      Velocity.vx[v] = -Velocity.vx[v];
    } else if (Position.x[p] > width) {
      Position.x[p] = width;
      Velocity.vx[v] = -Velocity.vx[v];
    }

    if (Position.y[p] < 0) {
      Position.y[p] = 0;
      Velocity.vy[v] = -Velocity.vy[v];
    } else if (Position.y[p] > height) {
      Position.y[p] = height;
      Velocity.vy[v] = -Velocity.vy[v];
    }
  }
}
