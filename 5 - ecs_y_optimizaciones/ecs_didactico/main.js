import { World } from "./world.js";
import { Position, Velocity } from "./components.js";
import { physicsSystem } from "./physicsSystem.js";
import { boundsSystem } from "./boundsSystem.js";
import { createRenderSystem } from "./renderSystem.js";

const viewport = document.getElementById("viewport");

const world = new World({ width: 800, height: 600 });

// Los sistemas se registran en el World. Ninguna entidad los "elige".
world.addSystem(physicsSystem);
world.addSystem(boundsSystem);
world.addSystem(createRenderSystem(viewport));

// Peces: Position + Velocity → los mueven physics y bounds.
for (let i = 0; i < 200; i++) {
  const id = world.createEntity();
  world.addComponent(id, Position, {
    x: Math.random() * world.width,
    y: Math.random() * world.height,
  });
  world.addComponent(id, Velocity, {
    vx: (Math.random() - 0.5) * 120,
    vy: (Math.random() - 0.5) * 120,
  });
}

// Anclas: solo Position → el render las dibuja, pero nadie las mueve.
// Eso es composición: misma entidad-base, distintos componentes.
for (let i = 0; i < 5; i++) {
  const id = world.createEntity();
  world.addComponent(id, Position, {
    x: 100 + i * 150,
    y: 300,
  });
}

world.start();

window.world = world;
