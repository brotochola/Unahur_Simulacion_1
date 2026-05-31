import { PreRenderSystem } from "./preRenderSystem.js";
import { RenderQueue } from "./renderQueue.js";

// World — orquestador principal de la simulación.
//
// Responsabilidades:
//   - Registrar tipos de entidades y sus sistemas
//   - Calcular deltaTime y ejecutar los sistemas cada frame
//   - Inicializar el renderer (sync o async) antes del primer frame
//   - Delegar el dibujado al renderer activo
//
// El World no sabe qué renderer está usando ni cómo funcionan los sistemas.
// Solo llama a sus métodos. Esto es el patrón Strategy aplicado a ambos.
export class World {
  static instance = null;

  constructor({ width, height, renderer, viewport = null }) {
    this.width = width;
    this.height = height;
    this.renderer = renderer;

    // Referencia global para debugging desde la consola del browser
    World.instance = this;
    window.world = this;

    // Iniciar el renderer. Si es async (Three.js/WebGPU), guardamos la Promise.
    // Si es sync (canvas, software), resuelve inmediatamente.
    // startGameLoop() espera a que _rendererReady resuelva antes del primer frame.
    this._rendererReady = viewport
      ? this.bootRenderer(viewport)
      : Promise.resolve();

    this.entityTypes = [];
    this.systems = [];

    // Timing del game loop
    this.fps = 0;
    this._now = 0;
    this.lastTime = 0;
    this.deltaTime = 0;
    this._frameCount = 0;
    this._fpsAccum = 0;

    // Se pre-bindea una sola vez para no crear funciones nuevas cada frame (zero GC)
    this._boundLoop = this._loop.bind(this);
  }

  // Inicia el renderer de forma unificada para init() sync y async.
  //
  // Un constructor no puede ser async, pero puede llamar a un método
  // que devuelva una Promise. Esa Promise se guarda en _rendererReady
  // y se usa como gate antes del primer frame.
  bootRenderer(viewport) {
    if (this.renderer._initialized) {
      return Promise.resolve();
    }
    if (typeof this.renderer.init !== "function") {
      return Promise.resolve();
    }
    const result = this.renderer.init(viewport);
    // Si init() devuelve una Promise → async (Three.js)
    // Si devuelve undefined → sync (canvas, software)
    return result && typeof result.then === "function"
      ? result
      : Promise.resolve();
  }

  // Registrar un tipo de entidad y conectar sus sistemas al World.
  //
  // Para cada sistema que usa la entidad:
  //   - Se agrega el pool a system.targets (para que lo itere cada frame)
  //   - Se registra el sistema en el World si no estaba antes
  //
  // registerPool se encola en _rendererReady para garantizar que el renderer
  // esté listo antes de crear meshes/elementos DOM.
  registerEntityClass(entityClass, numberOfEntities = 1000) {
    entityClass.init(numberOfEntities);

    // Encolar registerPool después de que el renderer esté inicializado.
    // Para renderers sync esto resuelve de inmediato.
    // Para Three.js (async) espera a que la escena esté creada.
    this._rendererReady = this._rendererReady.then(() => {
      this.renderer.registerPool(entityClass);
    });

    this.entityTypes.push(entityClass);

    // Inicializar la RenderQueue la primera vez que hay una entidad con PreRenderSystem
    this._renderQueueCapacity =
      (this._renderQueueCapacity || 0) + numberOfEntities;
    if (!PreRenderSystem._initialized) {
      PreRenderSystem.init(this._renderQueueCapacity);
    }

    const systems = entityClass.systems;

    for (let i = 0; i < systems.length; i++) {
      const system = systems[i];

      system.targets.push(entityClass);

      // Asignar id numérico al pool en la RenderQueue
      if (system === PreRenderSystem && entityClass.poolId === -1) {
        RenderQueue.registerPool(entityClass);
      }

      // Cada sistema se registra en el World una sola vez
      if (!system._registered) {
        system._registered = true;
        this.systems.push(system);
      }
    }
  }

  clear() {
    this.entityTypes.length = 0;

    for (let i = 0; i < this.systems.length; i++) {
      this.systems[i].targets.length = 0;
      this.systems[i]._registered = false;
    }

    this.systems.length = 0;
  }

  // Cálculo de deltaTime y ejecución de sistemas.
  //
  // deltaTime = tiempo transcurrido desde el frame anterior, en segundos.
  // Se usa en PhysicsSystem para que la velocidad sea independiente del FPS:
  //   posición += velocidad × deltaTime
  //
  // FPS se calcula acumulando frames durante 1 segundo y promediando.
  update() {
    this._now = performance.now();
    this.deltaTime = (this._now - this.lastTime) / 1000;
    this.lastTime = this._now;
    this._fpsAccum += this.deltaTime;
    this._frameCount++;
    if (this._fpsAccum >= 1) {
      this.fps = this._frameCount / this._fpsAccum;
      this._frameCount = 0;
      this._fpsAccum = 0;
    }

    const systems = this.systems;
    for (let i = 0; i < systems.length; i++) {
      systems[i].update(this.deltaTime);
    }
  }

  // Loop principal: update → draw → pedir siguiente frame.
  // Es async porque el renderer puede ser async (ThreeRenderSystem.draw usa await).
  // requestAnimationFrame sincroniza con el vsync del monitor (~60fps).
  async _loop() {
    this.update();
    await this.renderer.draw();
    requestAnimationFrame(this._boundLoop);
  }

  // Arrancar el game loop una vez que el renderer esté listo.
  startGameLoop() {
    this._rendererReady.then(() => {
      this.lastTime = performance.now();
      requestAnimationFrame(this._boundLoop);
    });
  }
}
