import { World } from "./world.js";
import { Fish } from "./fish.js";
import { SoftwareRenderSystem } from "./softwareRenderSystem.js";
import { ThreeRenderSystem } from "./threeRenderSystem.js";

const world = new World({
  width: 800,
  height: 600,
  renderer: SoftwareRenderSystem,
  // renderer: ThreeRenderSystem,
  viewport: document.getElementById("viewport"),
});

world.registerEntityClass(Fish, 10000);
world.startGameLoop();

for (let i = 0; i < 10000; i++) {
  const fish = Fish.create();
  fish.x = Math.random() * world.width;
  fish.y = Math.random() * world.height;
  fish.vx = (Math.random() - 0.5) * 120;
  fish.vy = (Math.random() - 0.5) * 120;
}
