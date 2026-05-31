class World {
  constructor() {
    // ============================================================
    // Tipos registrados y sistemas activos
    // ============================================================
    this.entityTypes = [];
    this.systems = [];

    // ============================================================
    // Timing
    // ============================================================
    this.fps = 0;
    this._now = 0;
    this.lastTime = 0;
    this.deltaTime = 0;
    this._frameCount = 0;
    this._fpsAccum = 0;

    // ============================================================
    // Loop pre-bindeado: se alloca UNA sola vez en el constructor.
    // requestAnimationFrame siempre recibe la misma referencia → cero GC.
    // ============================================================
    this._boundLoop = this._loop.bind(this);
  }

  // ============================================================
  // Registro de tipos
  //
  // Fish.systems = [PhysicsSystem, CollisionSystem, ...]
  // ============================================================
  registerEntityClass(entityClass, numberOfEntities = 1000) {
    entityClass.init(numberOfEntities);

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

  // ============================================================
  // Limpia todo el mundo
  // ============================================================
  clear() {
    this.entityTypes.length = 0;

    for (let i = 0; i < this.systems.length; i++) {
      this.systems[i].targets.length = 0;
      this.systems[i]._registered = false;
    }

    this.systems.length = 0;
  }

  // ============================================================
  // Update — computa dt internamente y lo pasa a cada sistema
  // ============================================================
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

  _loop() {
    this.update();
    RenderSystem.draw();
    requestAnimationFrame(this._boundLoop);
  }

  startGameLoop() {
    this.lastTime = performance.now();
    requestAnimationFrame(this._boundLoop);
  }
}
