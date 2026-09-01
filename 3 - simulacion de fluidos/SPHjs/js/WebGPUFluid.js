const WORKGROUP_SIZE = 64;
const PARTICLE_STRIDE = 16;
const UNIFORM_BYTE_SIZE = 96;
const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const PARAMETERS_WGSL = `
struct SimulationParameters {
  resolution: vec2<f32>,
  gravity: vec2<f32>,
  dt: f32,
  count: u32,
  gridColumns: u32,
  gridRows: u32,
  smoothingRadius: f32,
  restDensity: f32,
  stiffness: f32,
  nearStiffness: f32,
  minimumPressure: f32,
  damping: f32,
  velocityLimit: f32,
  boundaryPadding: f32,
  repulsor: vec2<f32>,
  repulsorRadius: f32,
  repulsorStrength: f32,
  repulsorActive: u32,
  pointDiameter: f32,
  threshold: f32,
  padding: f32,
};

struct Particle {
  position: vec2<f32>,
  velocity: vec2<f32>,
};
`;

const CLEAR_GRID_SHADER = `${PARAMETERS_WGSL}
@group(0) @binding(0) var<uniform> parameters: SimulationParameters;
@group(0) @binding(1) var<storage, read_write> gridHeads: array<atomic<i32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  let cellCount = parameters.gridColumns * parameters.gridRows;
  if (index < cellCount) {
    atomicStore(&gridHeads[index], -1);
  }
}
`;

const INTEGRATE_SHADER = `${PARAMETERS_WGSL}
@group(0) @binding(0) var<uniform> parameters: SimulationParameters;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> predicted: array<vec2<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  if (index >= parameters.count) {
    return;
  }

  let particle = particles[index];
  var velocity = (particle.velocity + parameters.gravity * parameters.dt)
    * parameters.damping;

  if (parameters.repulsorActive != 0u) {
    var delta = particle.position - parameters.repulsor;
    var distanceSquared = dot(delta, delta);
    let radiusSquared = parameters.repulsorRadius * parameters.repulsorRadius;

    if (distanceSquared < radiusSquared) {
      if (distanceSquared < 0.0001) {
        let hash = (index * 1664525u + 1013904223u) & 65535u;
        let angle = f32(hash) / 65535.0 * 6.28318530718;
        delta = vec2<f32>(cos(angle), sin(angle)) * 0.01;
        distanceSquared = 0.0001;
      }

      let distance = sqrt(distanceSquared);
      let falloff = 1.0 - distance / parameters.repulsorRadius;
      let impulse = parameters.repulsorStrength * falloff * falloff
        * parameters.dt;
      velocity += delta / distance * impulse;
    }
  }

  let speedSquared = dot(velocity, velocity);
  let limitSquared = parameters.velocityLimit * parameters.velocityLimit;
  if (speedSquared > limitSquared) {
    velocity *= parameters.velocityLimit / sqrt(speedSquared);
  }

  predicted[index] = particle.position + velocity * parameters.dt;
}
`;

const BUILD_GRID_SHADER = `${PARAMETERS_WGSL}
@group(0) @binding(0) var<uniform> parameters: SimulationParameters;
@group(0) @binding(1) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> gridHeads: array<atomic<i32>>;
@group(0) @binding(3) var<storage, read_write> nextParticle: array<i32>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  if (index >= parameters.count) {
    return;
  }

  let position = predicted[index];
  let maxColumn = i32(parameters.gridColumns) - 1;
  let maxRow = i32(parameters.gridRows) - 1;
  let column = clamp(
    i32(floor(position.x / parameters.smoothingRadius)),
    0,
    maxColumn,
  );
  let row = clamp(
    i32(floor(position.y / parameters.smoothingRadius)),
    0,
    maxRow,
  );
  let cell = u32(row) * parameters.gridColumns + u32(column);
  nextParticle[index] = atomicExchange(&gridHeads[cell], i32(index));
}
`;

const DENSITY_SHADER = `${PARAMETERS_WGSL}
@group(0) @binding(0) var<uniform> parameters: SimulationParameters;
@group(0) @binding(1) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> gridHeads: array<atomic<i32>>;
@group(0) @binding(3) var<storage, read> nextParticle: array<i32>;
@group(0) @binding(4) var<storage, read_write> densities: array<vec2<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  if (index >= parameters.count) {
    return;
  }

  let position = predicted[index];
  let inverseRadius = 1.0 / parameters.smoothingRadius;
  let radiusSquared = parameters.smoothingRadius * parameters.smoothingRadius;
  let centerColumn = clamp(
    i32(floor(position.x * inverseRadius)),
    0,
    i32(parameters.gridColumns) - 1,
  );
  let centerRow = clamp(
    i32(floor(position.y * inverseRadius)),
    0,
    i32(parameters.gridRows) - 1,
  );
  let minColumn = max(0, centerColumn - 1);
  let maxColumn = min(i32(parameters.gridColumns) - 1, centerColumn + 1);
  let minRow = max(0, centerRow - 1);
  let maxRow = min(i32(parameters.gridRows) - 1, centerRow + 1);
  var density = 1.0;
  var nearDensity = 1.0;

  for (var row = minRow; row <= maxRow; row += 1) {
    for (var column = minColumn; column <= maxColumn; column += 1) {
      let cell = u32(row) * parameters.gridColumns + u32(column);
      var neighbor = atomicLoad(&gridHeads[cell]);

      loop {
        if (neighbor < 0) {
          break;
        }
        let neighborIndex = u32(neighbor);
        if (neighborIndex != index) {
          let delta = position - predicted[neighborIndex];
          let distanceSquared = dot(delta, delta);
          if (distanceSquared < radiusSquared) {
            let distance = sqrt(distanceSquared);
            let weight = 1.0 - distance * inverseRadius;
            let densityWeight = weight * weight;
            density += densityWeight;
            nearDensity += densityWeight * weight;
          }
        }
        neighbor = nextParticle[neighborIndex];
      }
    }
  }

  densities[index] = vec2<f32>(density, nearDensity);
}
`;

const RELAX_SHADER = `${PARAMETERS_WGSL}
@group(0) @binding(0) var<uniform> parameters: SimulationParameters;
@group(0) @binding(1) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> gridHeads: array<atomic<i32>>;
@group(0) @binding(3) var<storage, read> nextParticle: array<i32>;
@group(0) @binding(4) var<storage, read> densities: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> relaxed: array<vec2<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  if (index >= parameters.count) {
    return;
  }

  let position = predicted[index];
  let ownDensity = densities[index];
  let ownPressure = max(
    parameters.minimumPressure,
    ownDensity.x - parameters.restDensity,
  ) * parameters.stiffness;
  let ownNearPressure = ownDensity.y * parameters.nearStiffness;
  let inverseRadius = 1.0 / parameters.smoothingRadius;
  let radiusSquared = parameters.smoothingRadius * parameters.smoothingRadius;
  let centerColumn = clamp(
    i32(floor(position.x * inverseRadius)),
    0,
    i32(parameters.gridColumns) - 1,
  );
  let centerRow = clamp(
    i32(floor(position.y * inverseRadius)),
    0,
    i32(parameters.gridRows) - 1,
  );
  let minColumn = max(0, centerColumn - 1);
  let maxColumn = min(i32(parameters.gridColumns) - 1, centerColumn + 1);
  let minRow = max(0, centerRow - 1);
  let maxRow = min(i32(parameters.gridRows) - 1, centerRow + 1);
  let maximumPairDisplacement = parameters.smoothingRadius * 0.06;
  var correction = vec2<f32>(0.0);

  for (var row = minRow; row <= maxRow; row += 1) {
    for (var column = minColumn; column <= maxColumn; column += 1) {
      let cell = u32(row) * parameters.gridColumns + u32(column);
      var neighbor = atomicLoad(&gridHeads[cell]);

      loop {
        if (neighbor < 0) {
          break;
        }
        let neighborIndex = u32(neighbor);
        if (neighborIndex != index) {
          var delta = position - predicted[neighborIndex];
          var distanceSquared = dot(delta, delta);

          if (distanceSquared < radiusSquared) {
            if (distanceSquared < 0.0001) {
              let hash = (index * 1664525u + neighborIndex * 1013904223u)
                & 65535u;
              let angle = f32(hash) / 65535.0 * 6.28318530718;
              delta = vec2<f32>(cos(angle), sin(angle)) * 0.01;
              distanceSquared = 0.0001;
            }

            let distance = sqrt(distanceSquared);
            let normal = delta / distance;
            let weight = 1.0 - distance * inverseRadius;
            let neighborDensity = densities[neighborIndex];
            let neighborPressure = max(
              parameters.minimumPressure,
              neighborDensity.x - parameters.restDensity,
            ) * parameters.stiffness;
            let neighborNearPressure = neighborDensity.y
              * parameters.nearStiffness;
            let pressure = (ownPressure + neighborPressure) * 0.5;
            let nearPressure = (ownNearPressure + neighborNearPressure) * 0.5;
            var displacement = parameters.dt * parameters.dt * (
              pressure * weight + nearPressure * weight * weight
            ) * 0.5;
            displacement = clamp(
              displacement,
              -maximumPairDisplacement * 0.2,
              maximumPairDisplacement,
            );
            correction += normal * displacement;
          }
        }
        neighbor = nextParticle[neighborIndex];
      }
    }
  }

  let maximumTotalDisplacement = parameters.smoothingRadius * 0.12;
  let correctionSquared = dot(correction, correction);
  if (correctionSquared
      > maximumTotalDisplacement * maximumTotalDisplacement) {
    correction *= maximumTotalDisplacement / sqrt(correctionSquared);
  }
  relaxed[index] = position + correction;
}
`;

const FINALIZE_SHADER = `${PARAMETERS_WGSL}
@group(0) @binding(0) var<uniform> parameters: SimulationParameters;
@group(0) @binding(1) var<storage, read> particlesIn: array<Particle>;
@group(0) @binding(2) var<storage, read> relaxed: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> particlesOut: array<Particle>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  if (index >= parameters.count) {
    return;
  }

  let minimum = parameters.boundaryPadding;
  let maximum = max(
    vec2<f32>(minimum),
    parameters.resolution - vec2<f32>(minimum),
  );
  var position = relaxed[index];
  var collision = vec4<bool>(false);

  if (position.x < minimum) {
    position.x = minimum;
    collision.x = true;
  } else if (position.x > maximum.x) {
    position.x = maximum.x;
    collision.y = true;
  }
  if (position.y < minimum) {
    position.y = minimum;
    collision.z = true;
  } else if (position.y > maximum.y) {
    position.y = maximum.y;
    collision.w = true;
  }

  var velocity = (position - particlesIn[index].position) / parameters.dt;
  let speedSquared = dot(velocity, velocity);
  let limitSquared = parameters.velocityLimit * parameters.velocityLimit;
  if (speedSquared > limitSquared) {
    velocity *= parameters.velocityLimit / sqrt(speedSquared);
  }

  if ((collision.x && velocity.x < 0.0)
      || (collision.y && velocity.x > 0.0)) {
    velocity.x *= -0.18;
  }
  if ((collision.z && velocity.y < 0.0)
      || (collision.w && velocity.y > 0.0)) {
    velocity.y *= -0.12;
  }

  particlesOut[index].position = position;
  particlesOut[index].velocity = velocity;
}
`;

const RESIZE_SHADER = `
struct ResizeParameters {
  scale: vec2<f32>,
  count: u32,
  padding: u32,
};

struct Particle {
  position: vec2<f32>,
  velocity: vec2<f32>,
};

@group(0) @binding(0) var<uniform> parameters: ResizeParameters;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  if (index < parameters.count) {
    particles[index].position *= parameters.scale;
    particles[index].velocity *= parameters.scale;
  }
}
`;

const PARTICLE_RENDER_SHADER = `${PARAMETERS_WGSL}
@group(0) @binding(0) var<uniform> parameters: SimulationParameters;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var particleTexture: texture_2d<f32>;
@group(0) @binding(3) var particleSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) textureCoordinate: vec2<f32>,
};

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let center = particles[instanceIndex].position;
  let pixel = center + corner * parameters.pointDiameter * 0.5;
  var output: VertexOutput;
  output.position = vec4<f32>(
    pixel.x / parameters.resolution.x * 2.0 - 1.0,
    1.0 - pixel.y / parameters.resolution.y * 2.0,
    0.0,
    1.0,
  );
  output.textureCoordinate = corner * 0.5 + vec2<f32>(0.5);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let water = textureSample(
    particleTexture,
    particleSampler,
    input.textureCoordinate,
  );
  if (water.a < 0.004) {
    discard;
  }
  return water;
}
`;

const COMPOSITE_SHADER = `${PARAMETERS_WGSL}
@group(0) @binding(0) var waterTexture: texture_2d<f32>;
@group(0) @binding(1) var waterSampler: sampler;
@group(0) @binding(2) var<uniform> parameters: SimulationParameters;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) textureCoordinate: vec2<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  let coordinates = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(2.0, 1.0),
    vec2<f32>(0.0, -1.0),
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  output.textureCoordinate = coordinates[vertexIndex];
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let water = textureSample(waterTexture, waterSampler, input.textureCoordinate);
  let mask = smoothstep(
    parameters.threshold - 0.012,
    parameters.threshold + 0.012,
    water.a,
  );
  return water * mask;
}
`;

async function checkedShaderModule(device, label, code) {
  const module = device.createShaderModule({ label, code });
  if (typeof module.getCompilationInfo === "function") {
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((message) => message.type === "error");
    if (errors.length > 0) {
      const details = errors
        .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join("\n");
      throw new Error(`${label} failed to compile:\n${details}`);
    }
  }
  return module;
}

async function loadParticleBitmap() {
  const response = await fetch(new URL("../circle.png", import.meta.url));
  if (!response.ok) {
    throw new Error(`Could not load circle.png (${response.status}).`);
  }
  return createImageBitmap(await response.blob());
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

class WebGPUFluid {
  constructor(canvas, adapter, device, {
    width = 1,
    height = 1,
    maxParticles = 6000,
    smoothingRadius = 32,
    boundaryPadding = 18,
    pointDiameter = 40,
  } = {}) {
    this.canvas = canvas;
    this.adapter = adapter;
    this.device = device;
    this.queue = device.queue;
    this.backend = "WebGPU · GPU physics";
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.logicalWidth = this.width;
    this.logicalHeight = this.height;
    this.pixelRatio = 1;
    this.maxParticles = Math.max(128, maxParticles | 0);
    this.count = 0;
    this.currentState = 0;

    this.smoothingRadius = smoothingRadius;
    this.restDensity = 5.2;
    this.stiffness = 850;
    this.nearStiffness = 1100;
    this.minimumPressure = -1.3;
    this.gravityStrength = 920;
    this.motionGravityStrength = 1800;
    this.gravityResponse = 18;
    this.gravityX = 0;
    this.gravityY = this.gravityStrength;
    this.targetGravityX = 0;
    this.targetGravityY = this.gravityStrength;
    this.velocityLimit = 800;
    this.boundaryPadding = Math.max(1, boundaryPadding);
    this.pointDiameter = pointDiameter;
    this.threshold = 160 / 255;
    this.emissionIndex = 0;
    this.repulsor = {
      active: false,
      x: 0,
      y: 0,
      radius: 88,
      strength: 6500,
      pulse: 0,
    };

    this.uniformBytes = new ArrayBuffer(UNIFORM_BYTE_SIZE);
    this.uniformFloats = new Float32Array(this.uniformBytes);
    this.uniformUints = new Uint32Array(this.uniformBytes);
    this.resizeBytes = new ArrayBuffer(16);
    this.resizeFloats = new Float32Array(this.resizeBytes);
    this.resizeUints = new Uint32Array(this.resizeBytes);
    this.gridCapacity = 0;
    this.waterTexture = null;
    this.destroyed = false;
  }

  get numParticles() {
    return this.count;
  }

  get CanvasWidth() {
    return this.width;
  }

  get CanvasHeight() {
    return this.height;
  }

  async initialize() {
    this.uniformBuffer = this.device.createBuffer({
      label: "SPH simulation parameters",
      size: UNIFORM_BYTE_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.resizeUniformBuffer = this.device.createBuffer({
      label: "SPH resize parameters",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const particleBufferSize = this.maxParticles * PARTICLE_STRIDE;
    this.stateBuffers = [0, 1].map((index) => this.device.createBuffer({
      label: `SPH particle state ${index}`,
      size: particleBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));
    this.predictedBuffer = this.device.createBuffer({
      label: "SPH predicted positions",
      size: this.maxParticles * 8,
      usage: GPUBufferUsage.STORAGE,
    });
    this.densityBuffer = this.device.createBuffer({
      label: "SPH densities",
      size: this.maxParticles * 8,
      usage: GPUBufferUsage.STORAGE,
    });
    this.relaxedBuffer = this.device.createBuffer({
      label: "SPH relaxed positions",
      size: this.maxParticles * 8,
      usage: GPUBufferUsage.STORAGE,
    });
    this.nextParticleBuffer = this.device.createBuffer({
      label: "SPH grid links",
      size: this.maxParticles * 4,
      usage: GPUBufferUsage.STORAGE,
    });

    const shaderModules = await Promise.all([
      checkedShaderModule(this.device, "clear-grid shader", CLEAR_GRID_SHADER),
      checkedShaderModule(this.device, "integrate shader", INTEGRATE_SHADER),
      checkedShaderModule(this.device, "build-grid shader", BUILD_GRID_SHADER),
      checkedShaderModule(this.device, "density shader", DENSITY_SHADER),
      checkedShaderModule(this.device, "relax shader", RELAX_SHADER),
      checkedShaderModule(this.device, "finalize shader", FINALIZE_SHADER),
      checkedShaderModule(this.device, "resize shader", RESIZE_SHADER),
      checkedShaderModule(
        this.device,
        "particle render shader",
        PARTICLE_RENDER_SHADER,
      ),
      checkedShaderModule(this.device, "composite shader", COMPOSITE_SHADER),
    ]);

    const [
      clearModule,
      integrateModule,
      buildModule,
      densityModule,
      relaxModule,
      finalizeModule,
      resizeModule,
      particleModule,
      compositeModule,
    ] = shaderModules;

    [
      this.clearPipeline,
      this.integratePipeline,
      this.buildPipeline,
      this.densityPipeline,
      this.relaxPipeline,
      this.finalizePipeline,
      this.resizePipeline,
    ] = await Promise.all([
      ["SPH clear grid", clearModule],
      ["SPH integrate", integrateModule],
      ["SPH build grid", buildModule],
      ["SPH density", densityModule],
      ["SPH relax", relaxModule],
      ["SPH finalize", finalizeModule],
      ["SPH resize", resizeModule],
    ].map(([label, module]) => this.device.createComputePipelineAsync({
      label,
      layout: "auto",
      compute: { module, entryPoint: "main" },
    })));

    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    [this.particlePipeline, this.compositePipeline] = await Promise.all([
      this.device.createRenderPipelineAsync({
        label: "SPH particle accumulation",
        layout: "auto",
        vertex: { module: particleModule, entryPoint: "vertexMain" },
        fragment: {
          module: particleModule,
          entryPoint: "fragmentMain",
          targets: [{
            format: "rgba8unorm",
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
      }),
      this.device.createRenderPipelineAsync({
        label: "SPH water composite",
        layout: "auto",
        vertex: { module: compositeModule, entryPoint: "vertexMain" },
        fragment: {
          module: compositeModule,
          entryPoint: "fragmentMain",
          targets: [{ format: this.canvasFormat }],
        },
        primitive: { topology: "triangle-list" },
      }),
    ]);

    this._createFixedBindGroups();
    this._allocateGrid();
    await this._initializeRenderer();
    this._writeUniforms(1 / 60);
    return this;
  }

  _createFixedBindGroups() {
    const resource = (buffer) => ({ buffer });
    this.integrateBindGroups = this.stateBuffers.map((stateBuffer) => (
      this.device.createBindGroup({
        label: "SPH integrate bindings",
        layout: this.integratePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: resource(this.uniformBuffer) },
          { binding: 1, resource: resource(stateBuffer) },
          { binding: 2, resource: resource(this.predictedBuffer) },
        ],
      })
    ));
    this.finalizeBindGroups = [0, 1].map((stateIndex) => (
      this.device.createBindGroup({
        label: "SPH finalize bindings",
        layout: this.finalizePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: resource(this.uniformBuffer) },
          { binding: 1, resource: resource(this.stateBuffers[stateIndex]) },
          { binding: 2, resource: resource(this.relaxedBuffer) },
          { binding: 3, resource: resource(this.stateBuffers[1 - stateIndex]) },
        ],
      })
    ));
    this.resizeBindGroups = this.stateBuffers.map((stateBuffer) => (
      this.device.createBindGroup({
        label: "SPH resize bindings",
        layout: this.resizePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: resource(this.resizeUniformBuffer) },
          { binding: 1, resource: resource(stateBuffer) },
        ],
      })
    ));
  }

  _allocateGrid() {
    this.gridColumns = Math.max(1, Math.ceil(this.width / this.smoothingRadius));
    this.gridRows = Math.max(1, Math.ceil(this.height / this.smoothingRadius));
    const requiredCells = this.gridColumns * this.gridRows;
    if (requiredCells <= this.gridCapacity) {
      return;
    }

    this.gridCapacity = nextPowerOfTwo(requiredCells);
    this._retireResource(this.gridHeadsBuffer);
    this.gridHeadsBuffer = this.device.createBuffer({
      label: "SPH atomic grid heads",
      size: this.gridCapacity * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    this._createGridBindGroups();
  }

  _retireResource(resource) {
    if (!resource) {
      return;
    }
    this.queue.onSubmittedWorkDone().then(() => {
      resource.destroy();
    }).catch(() => {
      resource.destroy();
    });
  }

  _createGridBindGroups() {
    const resource = (buffer) => ({ buffer });
    const sharedEntries = [
      { binding: 0, resource: resource(this.uniformBuffer) },
      { binding: 1, resource: resource(this.predictedBuffer) },
      { binding: 2, resource: resource(this.gridHeadsBuffer) },
      { binding: 3, resource: resource(this.nextParticleBuffer) },
    ];
    this.clearBindGroup = this.device.createBindGroup({
      label: "SPH clear-grid bindings",
      layout: this.clearPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: resource(this.uniformBuffer) },
        { binding: 1, resource: resource(this.gridHeadsBuffer) },
      ],
    });
    this.buildBindGroup = this.device.createBindGroup({
      label: "SPH build-grid bindings",
      layout: this.buildPipeline.getBindGroupLayout(0),
      entries: sharedEntries,
    });
    this.densityBindGroup = this.device.createBindGroup({
      label: "SPH density bindings",
      layout: this.densityPipeline.getBindGroupLayout(0),
      entries: [
        ...sharedEntries,
        { binding: 4, resource: resource(this.densityBuffer) },
      ],
    });
    this.relaxBindGroup = this.device.createBindGroup({
      label: "SPH relax bindings",
      layout: this.relaxPipeline.getBindGroupLayout(0),
      entries: [
        ...sharedEntries,
        { binding: 4, resource: resource(this.densityBuffer) },
        { binding: 5, resource: resource(this.relaxedBuffer) },
      ],
    });
  }

  async _initializeRenderer() {
    const bitmap = await loadParticleBitmap();
    this.particleTexture = this.device.createTexture({
      label: "Original SPH water particle",
      size: [bitmap.width, bitmap.height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_DST
        | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: this.particleTexture },
      [bitmap.width, bitmap.height],
    );
    bitmap.close?.();
    this.sampler = this.device.createSampler({
      label: "SPH linear clamp sampler",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.context = this.canvas.getContext("webgpu");
    if (!this.context) {
      throw new Error("This browser exposed WebGPU but not a canvas context.");
    }
    this.context.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: "premultiplied",
    });
    this._createRenderBindGroups();
    this._resizeDrawingBuffer();
  }

  _createRenderBindGroups() {
    if (!this.particleTexture || !this.sampler) {
      return;
    }
    const resource = (buffer) => ({ buffer });
    this.renderBindGroups = this.stateBuffers.map((stateBuffer) => (
      this.device.createBindGroup({
        label: "SPH particle render bindings",
        layout: this.particlePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: resource(this.uniformBuffer) },
          { binding: 1, resource: resource(stateBuffer) },
          { binding: 2, resource: this.particleTexture.createView() },
          { binding: 3, resource: this.sampler },
        ],
      })
    ));
  }

  _resizeDrawingBuffer() {
    const drawingWidth = Math.max(1, Math.round(this.logicalWidth * this.pixelRatio));
    const drawingHeight = Math.max(1, Math.round(this.logicalHeight * this.pixelRatio));
    if (
      this.canvas.width === drawingWidth
      && this.canvas.height === drawingHeight
      && this.waterTexture
    ) {
      return;
    }
    this.canvas.width = drawingWidth;
    this.canvas.height = drawingHeight;
    this._retireResource(this.waterTexture);
    this.waterTexture = this.device.createTexture({
      label: "SPH accumulated water",
      size: [drawingWidth, drawingHeight],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.compositeBindGroup = this.device.createBindGroup({
      label: "SPH composite bindings",
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.waterTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  _writeUniforms(dt) {
    const floats = this.uniformFloats;
    const uints = this.uniformUints;
    floats[0] = this.width;
    floats[1] = this.height;
    floats[2] = this.gravityX;
    floats[3] = this.gravityY;
    floats[4] = dt;
    uints[5] = this.count;
    uints[6] = this.gridColumns;
    uints[7] = this.gridRows;
    floats[8] = this.smoothingRadius;
    floats[9] = this.restDensity;
    floats[10] = this.stiffness;
    floats[11] = this.nearStiffness;
    floats[12] = this.minimumPressure;
    floats[13] = Math.pow(0.98, dt * 60);
    floats[14] = this.velocityLimit;
    floats[15] = this.boundaryPadding;
    floats[16] = this.repulsor.x;
    floats[17] = this.repulsor.y;
    floats[18] = this.repulsor.radius;
    floats[19] = this.repulsor.strength;
    uints[20] = this.repulsor.active || this.repulsor.pulse > 0 ? 1 : 0;
    floats[21] = this.pointDiameter;
    floats[22] = this.threshold;
    floats[23] = 0;
    this.queue.writeBuffer(this.uniformBuffer, 0, this.uniformBytes);
  }

  resize(width, height, pixelRatio = this.pixelRatio) {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    const oldWidth = this.width;
    const oldHeight = this.height;
    const oldAspect = oldWidth / oldHeight;
    const nextAspect = nextWidth / nextHeight;
    const changed = nextWidth !== oldWidth || nextHeight !== oldHeight;

    if (changed && this.count > 0
        && Math.abs(Math.log(nextAspect / oldAspect)) > 0.45) {
      this.resizeFloats[0] = nextWidth / oldWidth;
      this.resizeFloats[1] = nextHeight / oldHeight;
      this.resizeUints[2] = this.count;
      this.resizeUints[3] = 0;
      this.queue.writeBuffer(this.resizeUniformBuffer, 0, this.resizeBytes);
      const encoder = this.device.createCommandEncoder({ label: "SPH resize" });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.resizePipeline);
      pass.setBindGroup(0, this.resizeBindGroups[this.currentState]);
      pass.dispatchWorkgroups(Math.ceil(this.count / WORKGROUP_SIZE));
      pass.end();
      this.queue.submit([encoder.finish()]);
    }

    this.width = nextWidth;
    this.height = nextHeight;
    this.logicalWidth = nextWidth;
    this.logicalHeight = nextHeight;
    this.pixelRatio = Math.max(0.5, pixelRatio);
    this._allocateGrid();
    if (this.context) {
      this._resizeDrawingBuffer();
    }
  }

  setBoundaryPadding(padding) {
    if (Number.isFinite(padding)) {
      this.boundaryPadding = clamp(
        padding,
        1,
        Math.max(1, Math.min(this.width, this.height) * 0.5),
      );
    }
  }

  setParticleDiameter(diameter) {
    if (Number.isFinite(diameter)) {
      this.pointDiameter = Math.max(8, diameter);
    }
  }

  setGravityDirection(x, y) {
    const magnitude = Math.hypot(x, y);
    if (!Number.isFinite(magnitude)) {
      return;
    }
    const scale = magnitude > 1 ? 1 / magnitude : 1;
    this.targetGravityX = x * scale * this.motionGravityStrength;
    this.targetGravityY = y * scale * this.motionGravityStrength;
  }

  resetGravity() {
    this.targetGravityX = 0;
    this.targetGravityY = this.gravityStrength;
  }

  setRepulsor(x, y, active = true) {
    this.repulsor.x = x;
    this.repulsor.y = y;
    this.repulsor.active = active;
  }

  push(x, y, radius = 88) {
    this.repulsor.x = x;
    this.repulsor.y = y;
    this.repulsor.radius = radius;
    this.repulsor.pulse = 0.7;
  }

  addParticle(x, y, vx = 0, vy = 0) {
    if (this.count >= this.maxParticles) {
      return false;
    }
    const padding = this.boundaryPadding;
    const particle = new Float32Array([
      clamp(x, padding, Math.max(padding, this.width - padding)),
      clamp(y, padding, Math.max(padding, this.height - padding)),
      vx,
      vy,
    ]);
    this.queue.writeBuffer(
      this.stateBuffers[this.currentState],
      this.count * PARTICLE_STRIDE,
      particle,
    );
    this.count += 1;
    return true;
  }

  emit(x, y, amount = 1, vx = 0, vy = 70) {
    const available = Math.min(amount, this.maxParticles - this.count);
    if (available <= 0) {
      return 0;
    }

    const batch = this.emissionIndex++;
    const hasCenter = (available & 1) === 1;
    const ringCount = available - (hasCenter ? 1 : 0);
    const phase = batch * 2.3999632297;
    const radius = 11 + (batch % 3) * 2;
    const particles = new Float32Array(available * 4);
    const padding = this.boundaryPadding;

    for (let n = 0; n < available; n += 1) {
      let offsetX = 0;
      let offsetY = 0;
      if (!hasCenter || n > 0) {
        const ringIndex = hasCenter ? n - 1 : n;
        const angle = phase + ringIndex * TAU / ringCount;
        offsetX = Math.cos(angle) * radius;
        offsetY = Math.sin(angle) * radius;
      }
      const offset = n * 4;
      particles[offset] = clamp(
        x + offsetX,
        padding,
        Math.max(padding, this.width - padding),
      );
      particles[offset + 1] = clamp(
        y + offsetY,
        padding,
        Math.max(padding, this.height - padding),
      );
      particles[offset + 2] = vx + offsetX * 0.25;
      particles[offset + 3] = vy;
    }

    this.queue.writeBuffer(
      this.stateBuffers[this.currentState],
      this.count * PARTICLE_STRIDE,
      particles,
    );
    this.count += available;
    return available;
  }

  seedPool(requestedCount = 420) {
    this.clear();
    const spacing = 10.5;
    const usableWidth = Math.max(spacing * 2, this.width - this.boundaryPadding * 2);
    const columns = Math.max(2, Math.floor(usableWidth / spacing));
    const availableRows = Math.max(
      1,
      Math.floor((this.height - this.boundaryPadding * 2) / spacing),
    );
    const count = Math.min(
      requestedCount,
      columns * availableRows,
      this.maxParticles,
    );
    const particles = new Float32Array(count * 4);
    const actualWidth = (columns - 1) * spacing;
    const startX = (this.width - actualWidth) * 0.5;
    const bottom = this.height - this.boundaryPadding;

    for (let i = 0; i < count; i += 1) {
      const row = Math.floor(i / columns);
      const column = i % columns;
      const rowOffset = (row & 1) * spacing * 0.5;
      const offset = i * 4;
      particles[offset] = clamp(
        startX + column * spacing + rowOffset,
        this.boundaryPadding,
        this.width - this.boundaryPadding,
      );
      particles[offset + 1] = bottom - row * spacing;
      particles[offset + 2] = 0;
      particles[offset + 3] = 0;
    }

    if (count > 0) {
      this.queue.writeBuffer(this.stateBuffers[this.currentState], 0, particles);
    }
    this.count = count;
    return count;
  }

  clear() {
    this.count = 0;
    this.emissionIndex = 0;
    this.repulsor.active = false;
    this.repulsor.pulse = 0;
  }

  step(dt) {
    if (this.count === 0 || this.destroyed) {
      return;
    }
    const safeDt = clamp(dt, 1 / 240, 1 / 30);
    const gravityBlend = 1 - Math.exp(-safeDt * this.gravityResponse);
    this.gravityX += (this.targetGravityX - this.gravityX) * gravityBlend;
    this.gravityY += (this.targetGravityY - this.gravityY) * gravityBlend;
    this._writeUniforms(safeDt);

    const particleGroups = Math.ceil(this.count / WORKGROUP_SIZE);
    const cellGroups = Math.ceil(
      this.gridColumns * this.gridRows / WORKGROUP_SIZE,
    );
    const encoder = this.device.createCommandEncoder({ label: "SPH GPU step" });

    const dispatch = (pipeline, bindGroup, groups) => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(groups);
      pass.end();
    };

    dispatch(this.integratePipeline, this.integrateBindGroups[this.currentState], particleGroups);
    dispatch(this.clearPipeline, this.clearBindGroup, cellGroups);
    dispatch(this.buildPipeline, this.buildBindGroup, particleGroups);
    dispatch(this.densityPipeline, this.densityBindGroup, particleGroups);
    dispatch(this.relaxPipeline, this.relaxBindGroup, particleGroups);
    dispatch(this.finalizePipeline, this.finalizeBindGroups[this.currentState], particleGroups);
    this.queue.submit([encoder.finish()]);
    this.currentState = 1 - this.currentState;
    this.repulsor.pulse = Math.max(0, this.repulsor.pulse - safeDt);
  }

  render() {
    if (this.destroyed || !this.context || !this.waterTexture) {
      return;
    }
    this._writeUniforms(1 / 60);
    const encoder = this.device.createCommandEncoder({ label: "SPH GPU render" });
    const waterPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.waterTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    waterPass.setPipeline(this.particlePipeline);
    waterPass.setBindGroup(0, this.renderBindGroups[this.currentState]);
    waterPass.draw(6, this.count);
    waterPass.end();

    const compositePass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    compositePass.setPipeline(this.compositePipeline);
    compositePass.setBindGroup(0, this.compositeBindGroup);
    compositePass.draw(3);
    compositePass.end();
    this.queue.submit([encoder.finish()]);
  }
}

export async function createWebGPUFluid(canvas, options = {}) {
  if (!globalThis.isSecureContext || !navigator.gpu) {
    return null;
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    return null;
  }
  const device = await adapter.requestDevice();
  const fluid = new WebGPUFluid(canvas, adapter, device, options);
  await fluid.initialize();
  device.lost.then((info) => {
    fluid.destroyed = true;
    console.error("WebGPU device lost:", info.message);
  });
  return fluid;
}
