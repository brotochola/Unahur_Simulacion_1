import { PreRenderSystem } from "./preRenderSystem.js";
import { RenderQueue } from "./renderQueue.js";

export class World {
  static instance = null;

  constructor({ width, height, renderer, viewport = null }) {
    this.width = width;
    this.height = height;
    this.renderer = renderer;
    World.instance = this;
    window.world = this;

    this._rendererReady = viewport
      ? this.bootRenderer(viewport)
      : Promise.resolve();

    this.entityTypes = [];
    this.systems = [];

    this.fps = 0;
    this._now = 0;
    this.lastTime = 0;
    this.deltaTime = 0;
    this._frameCount = 0;
    this._fpsAccum = 0;

    this._boundLoop = this._loop.bind(this);
  }

  bootRenderer(viewport) {
    if (this.renderer._initialized) {
      return Promise.resolve();
    }
    if (typeof this.renderer.init !== "function") {
      return Promise.resolve();
    }
    const result = this.renderer.init(viewport);
    return result && typeof result.then === "function"
      ? result
      : Promise.resolve();
  }

  registerEntityClass(entityClass, numberOfEntities = 1000) {
    entityClass.init(numberOfEntities);

    this._rendererReady = this._rendererReady.then(() => {
      this.renderer.registerPool(entityClass);
    });

    this.entityTypes.push(entityClass);

    this._renderQueueCapacity =
      (this._renderQueueCapacity || 0) + numberOfEntities;
    if (!PreRenderSystem._initialized) {
      PreRenderSystem.init(this._renderQueueCapacity);
    }

    const systems = entityClass.systems;

    for (let i = 0; i < systems.length; i++) {
      const system = systems[i];

      system.targets.push(entityClass);

      if (system === PreRenderSystem && entityClass.poolId === -1) {
        RenderQueue.registerPool(entityClass);
      }

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

  async _loop() {
    this.update();
    await this.renderer.draw();
    requestAnimationFrame(this._boundLoop);
  }

  startGameLoop() {
    this._rendererReady.then(() => {
      this.lastTime = performance.now();
      requestAnimationFrame(this._boundLoop);
    });
  }
}
