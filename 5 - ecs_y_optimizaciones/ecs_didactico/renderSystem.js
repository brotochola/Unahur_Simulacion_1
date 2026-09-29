import { Position, Velocity } from "./components.js";

// Canvas 2D simple. Dibuja TODO lo que tenga Position.
// Los que también tienen Velocity se ven rojos; los anclas (solo Position), cyan.
export function createRenderSystem(viewport) {
  const canvas = document.createElement("canvas");
  canvas.width = viewport.clientWidth;
  canvas.height = viewport.clientHeight;
  canvas.style.display = "block";
  viewport.appendChild(canvas);

  const ctx = canvas.getContext("2d");

  return function renderSystem(world) {
    const t0 = performance.now();

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const ids = world.query(Position);

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const p = Position.slotOf(id);

      ctx.fillStyle = world.has(id, Velocity) ? "#e94560" : "#4ecdc4";
      ctx.fillRect(Position.x[p] - 2, Position.y[p] - 2, 4, 4);
    }

    // El World resta esto del total del update → processMs.
    world.renderMs = performance.now() - t0;
  };
}
