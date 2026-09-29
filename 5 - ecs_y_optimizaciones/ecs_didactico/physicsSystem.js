import { Position, Velocity } from "./components.js";

// Solo las entidades que tienen Position Y Velocity se mueven.
// Una entidad con solo Position (un ancla) no entra a este query.
export function physicsSystem(world, dt) {
  const ids = world.query(Position, Velocity);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const p = Position.slotOf(id);
    const v = Velocity.slotOf(id);

    Position.x[p] += Velocity.vx[v] * dt;
    Position.y[p] += Velocity.vy[v] * dt;
  }
}
