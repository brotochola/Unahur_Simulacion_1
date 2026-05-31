import { World } from "./world.js";
import { Fish } from "./fish.js";
import { ThreeRenderSystem } from "./threeRenderSystem.js";

const viewport = document.getElementById("viewport");
await ThreeRenderSystem.init(viewport);

const world = new World({
  width: 800,
  height: 600,
  renderer: ThreeRenderSystem,
});

world.registerEntityClass(Fish, 5000);
world.startGameLoop();

for (let i = 0; i < 5000; i++) {
  const fish = Fish.create();
  fish.x = Math.random() * world.width;
  fish.y = Math.random() * world.height;
  fish.vx = (Math.random() - 0.5) * 120;
  fish.vy = (Math.random() - 0.5) * 120;
}
