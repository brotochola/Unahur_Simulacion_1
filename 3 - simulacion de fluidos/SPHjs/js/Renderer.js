const PARTICLE_VERTEX_SHADER = `#version 300 es
  precision highp float;

  in vec2 aPosition;
  uniform vec2 uResolution;
  uniform float uPointSize;

  void main() {
    vec2 clip = (aPosition / uResolution) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    gl_PointSize = uPointSize;
  }
`;

const PARTICLE_FRAGMENT_SHADER = `#version 300 es
  precision mediump float;

  uniform sampler2D uParticleTexture;
  out vec4 fragmentColor;

  void main() {
    vec4 water = texture(
      uParticleTexture,
      vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y)
    );
    if (water.a < 0.004) {
      discard;
    }
    fragmentColor = water;
  }
`;

const COMPOSITE_VERTEX_SHADER = `#version 300 es
  precision highp float;

  out vec2 textureCoordinate;

  void main() {
    vec2 position = vec2(
      float((gl_VertexID << 1) & 2),
      float(gl_VertexID & 2)
    );
    // The oversized fullscreen triangle spans two UV units; interpolation
    // across the visible viewport produces the required 0..1 texture range.
    textureCoordinate = position;
    gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const COMPOSITE_FRAGMENT_SHADER = `#version 300 es
  precision mediump float;

  in vec2 textureCoordinate;
  uniform sampler2D uWater;
  uniform float uThreshold;
  out vec4 fragmentColor;

  void main() {
    vec4 water = texture(uWater, textureCoordinate);
    float mask = smoothstep(
      uThreshold - 0.012,
      uThreshold + 0.012,
      water.a
    );
    fragmentColor = water * mask;
  }
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Shader linking failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function createFallbackPixels(size = 64) {
  const pixels = new Uint8Array(size * size * 4);
  const center = (size - 1) * 0.5;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const distance = Math.hypot(dx, dy);
      const edge = Math.max(0, Math.min(1, (1 - distance) * 12));
      const offset = (y * size + x) * 4;
      pixels[offset] = 136;
      pixels[offset + 1] = 206;
      pixels[offset + 2] = 234;
      pixels[offset + 3] = Math.round(203 * edge);
    }
  }
  return pixels;
}

class WebGLFluidRenderer {
  constructor(canvas, gl, maxParticles) {
    this.canvas = canvas;
    this.gl = gl;
    this.backend = "WebGL2";
    this.logicalWidth = 1;
    this.logicalHeight = 1;
    this.pixelRatio = 1;
    this.pointDiameter = 40;
    this.threshold = 160 / 255;
    this.positions = new Float32Array(maxParticles * 2);
    this.maximumPointSize = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];

    this.particleProgram = createProgram(
      gl,
      PARTICLE_VERTEX_SHADER,
      PARTICLE_FRAGMENT_SHADER,
    );
    this.compositeProgram = createProgram(
      gl,
      COMPOSITE_VERTEX_SHADER,
      COMPOSITE_FRAGMENT_SHADER,
    );

    this.positionLocation = gl.getAttribLocation(
      this.particleProgram,
      "aPosition",
    );
    this.resolutionLocation = gl.getUniformLocation(
      this.particleProgram,
      "uResolution",
    );
    this.pointSizeLocation = gl.getUniformLocation(
      this.particleProgram,
      "uPointSize",
    );
    this.particleTextureLocation = gl.getUniformLocation(
      this.particleProgram,
      "uParticleTexture",
    );
    this.waterLocation = gl.getUniformLocation(
      this.compositeProgram,
      "uWater",
    );
    this.thresholdLocation = gl.getUniformLocation(
      this.compositeProgram,
      "uThreshold",
    );

    this.particleVertexArray = gl.createVertexArray();
    this.particleBuffer = gl.createBuffer();
    gl.bindVertexArray(this.particleVertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.positions.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.compositeVertexArray = gl.createVertexArray();
    this.particleTexture = this._createParticleTexture();
    this.waterTexture = null;
    this.waterFramebuffer = null;

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.particleProgram);
    gl.uniform1i(this.particleTextureLocation, 0);
    gl.useProgram(this.compositeProgram);
    gl.uniform1i(this.waterLocation, 0);
  }

  setParticleDiameter(diameter) {
    if (Number.isFinite(diameter)) {
      this.pointDiameter = Math.max(8, diameter);
    }
  }

  _createParticleTexture() {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      64,
      64,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      createFallbackPixels(),
    );

    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
    };
    image.src = new URL("../circle.png", import.meta.url).href;
    return texture;
  }

  resize(width, height, pixelRatio = 1) {
    this.logicalWidth = Math.max(1, Math.round(width));
    this.logicalHeight = Math.max(1, Math.round(height));
    this.pixelRatio = Math.max(0.75, pixelRatio);
    const drawingWidth = Math.max(
      1,
      Math.round(this.logicalWidth * this.pixelRatio),
    );
    const drawingHeight = Math.max(
      1,
      Math.round(this.logicalHeight * this.pixelRatio),
    );

    if (
      this.canvas.width === drawingWidth
      && this.canvas.height === drawingHeight
      && this.waterTexture
    ) {
      return;
    }

    this.canvas.width = drawingWidth;
    this.canvas.height = drawingHeight;
    this._createWaterTarget(drawingWidth, drawingHeight);
  }

  _createWaterTarget(width, height) {
    const gl = this.gl;

    if (this.waterTexture) {
      gl.deleteTexture(this.waterTexture);
    }
    if (this.waterFramebuffer) {
      gl.deleteFramebuffer(this.waterFramebuffer);
    }

    this.waterTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.waterTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );

    this.waterFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.waterFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.waterTexture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Could not create the water render target.");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(simulation) {
    const gl = this.gl;
    const count = simulation.count;

    for (let i = 0, offset = 0; i < count; i += 1, offset += 2) {
      this.positions[offset] = simulation.x[i];
      this.positions[offset + 1] = simulation.y[i];
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.waterFramebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );
    gl.useProgram(this.particleProgram);
    gl.uniform2f(
      this.resolutionLocation,
      this.logicalWidth,
      this.logicalHeight,
    );
    gl.uniform1f(
      this.pointSizeLocation,
      Math.min(this.pointDiameter * this.pixelRatio, this.maximumPointSize),
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.particleTexture);
    gl.bindVertexArray(this.particleVertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.positions.subarray(0, count * 2),
    );
    gl.drawArrays(gl.POINTS, 0, count);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.compositeProgram);
    gl.uniform1f(this.thresholdLocation, this.threshold);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.waterTexture);
    gl.bindVertexArray(this.compositeVertexArray);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}

class CanvasFluidRenderer {
  constructor(canvas, context) {
    this.canvas = canvas;
    this.context = context;
    this.backend = "Canvas 2D";
    this.logicalWidth = 1;
    this.logicalHeight = 1;
    this.pixelRatio = 1;
    this.pointDiameter = 40;
    this.sprite = this._createFallbackSprite();

    const image = new Image();
    image.onload = () => {
      this.sprite = image;
    };
    image.src = new URL("../circle.png", import.meta.url).href;
  }

  setParticleDiameter(diameter) {
    if (Number.isFinite(diameter)) {
      this.pointDiameter = Math.max(8, diameter);
    }
  }

  _createFallbackSprite() {
    const sprite = document.createElement("canvas");
    sprite.width = 64;
    sprite.height = 64;
    const context = sprite.getContext("2d");
    const gradient = context.createRadialGradient(32, 32, 20, 32, 32, 32);
    gradient.addColorStop(0, "rgba(136, 206, 234, 0.796)");
    gradient.addColorStop(1, "rgba(136, 206, 234, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    return sprite;
  }

  resize(width, height, pixelRatio = 1) {
    this.logicalWidth = Math.max(1, Math.round(width));
    this.logicalHeight = Math.max(1, Math.round(height));
    this.pixelRatio = Math.max(0.75, pixelRatio);
    this.canvas.width = Math.max(
      1,
      Math.round(this.logicalWidth * this.pixelRatio),
    );
    this.canvas.height = Math.max(
      1,
      Math.round(this.logicalHeight * this.pixelRatio),
    );
  }

  render(simulation) {
    const context = this.context;
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    const half = this.pointDiameter * 0.5;

    for (let i = 0; i < simulation.count; i += 1) {
      context.drawImage(
        this.sprite,
        simulation.x[i] - half,
        simulation.y[i] - half,
        this.pointDiameter,
        this.pointDiameter,
      );
    }
  }
}

export function createRenderer(canvas, maxParticles) {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    desynchronized: true,
    powerPreference: "high-performance",
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });

  if (gl) {
    return new WebGLFluidRenderer(canvas, gl, maxParticles);
  }

  const context = canvas.getContext("2d", {
    alpha: true,
    desynchronized: true,
  });
  if (!context) {
    throw new Error("This browser does not provide WebGL2 or Canvas 2D.");
  }
  return new CanvasFluidRenderer(canvas, context);
}
