// Punto de entrada de la aplicación.
//
// Acá se elige el renderer y se arma la escena.
// Para cambiar el renderer: descomentar la línea deseada y comentar la activa.
// El World maneja la inicialización (sync o async) de forma transparente.
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

// Spawear entidades con posición y velocidad aleatoria dentro del mundo
for (let i = 0; i < 10000; i++) {
  const fish = Fish.create();
  fish.x = Math.random() * world.width;
  fish.y = Math.random() * world.height;
  fish.vx = (Math.random() - 0.5) * 120; // px/seg
  fish.vy = (Math.random() - 0.5) * 120;
}
