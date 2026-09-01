class MetaballsRefraction {
  constructor(gl, canvas) {
    this.gl = gl;
    this.canvas = canvas;
    this.width = 0;
    this.height = 0;

    // Framebuffers and textures
    this.metaballsFramebuffer = null;
    this.metaballsTexture = null;
    this.blurFramebuffer1 = null;
    this.blurTexture1 = null;
    this.blurFramebuffer2 = null;
    this.blurTexture2 = null;

    // Background canvas and texture
    this.backgroundCanvas = null;
    this.backgroundCtx = null;
    this.backgroundTexture = null;
    this.backgroundNeedsUpdate = true;

    // Clock update tracking
    this.lastClockUpdate = 0;

    // Shader programs
    this.metaballsProgram = null;
    this.blurProgram = null;
    this.refractionProgram = null;
    this.fullscreenProgram = null;

    // Buffers
    this.quadBuffer = null;

    // Uniforms and attributes
    this.setupShaders();
    this.setupBuffers();
    this.resize(canvas.width, canvas.height);
  }

  // Reuse existing shader creation functions
  createShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('Shader compilation error:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  createProgram(vsSource, fsSource) {
    const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fsSource);

    if (!vertexShader || !fragmentShader) return null;

    const program = this.gl.createProgram();
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      console.error('Program linking error:', this.gl.getProgramInfoLog(program));
      this.gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  setupShaders() {
    // Metaballs vertex shader - renders particles to RGBA channels
    const metaballsVS = `
      attribute vec2 a_position;
      attribute float a_material;
      uniform vec2 u_resolution;
      uniform float u_pointSize;
      varying float v_material;

      void main() {
        vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
        gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
        gl_PointSize = u_pointSize;
        v_material = a_material;
      }
    `;

    const metaballsFS = `
      precision highp float;
      varying float v_material;

      void main() {
        vec2 center = vec2(0.5, 0.5);
        vec2 coord = gl_PointCoord - center;
        float dist = length(coord);
        
        if (dist > 0.5) discard;
        
        float intensity = 1.0 - smoothstep(0.0, 0.5, dist);
        
        // Write to different RGBA channels based on material
        vec4 color = vec4(0.0);
        int mat = int(v_material);
        if (mat == 0) color.r = intensity;
        else if (mat == 1) color.g = intensity;
        else if (mat == 2) color.b = intensity;
        else if (mat == 3) color.a = intensity;
        
        gl_FragColor = color;
      }
    `;

    // Separable Gaussian blur shaders
    const blurVS = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;

      void main() {
        gl_Position = vec4(a_position, 0, 1);
        v_texCoord = (a_position + 1.0) * 0.5;
      }
    `;

    const blurFS = `
      precision highp float;
      uniform sampler2D u_texture;
      uniform vec2 u_texelSize;
      uniform vec2 u_direction;
      varying vec2 v_texCoord;

      // Optimized blur using linear sampling - unrolled for better performance
      // Each sample represents two original taps combined

      void main() {
        // Start with center sample
        vec4 result = texture2D(u_texture, v_texCoord) * 0.159577;
        
        // Factor out common calculation
        vec2 step = u_direction * u_texelSize;
        
        // Unrolled optimized samples in each direction
        // Sample 0: positions 1 & 2 combined
        vec2 offset0 = 1.440405 * step;
        result += texture2D(u_texture, v_texCoord + offset0) * 0.263184;
        result += texture2D(u_texture, v_texCoord - offset0) * 0.263184;
        
        // Sample 1: positions 3 & 4 combined
        vec2 offset1 = 3.372549 * step;
        result += texture2D(u_texture, v_texCoord + offset1) * 0.125589;
        result += texture2D(u_texture, v_texCoord - offset1) * 0.125589;
        
        // Sample 2: positions 5 & 6 combined
        vec2 offset2 = 5.311321 * step;
        result += texture2D(u_texture, v_texCoord + offset2) * 0.035136;
        result += texture2D(u_texture, v_texCoord - offset2) * 0.035136;
        
        // Sample 3: positions 7 & 8 combined
        vec2 offset3 = 7.259259 * step;
        result += texture2D(u_texture, v_texCoord + offset3) * 0.005827;
        result += texture2D(u_texture, v_texCoord - offset3) * 0.005827;
        
        gl_FragColor = result;
      }
    `;

    // Refraction shader
    const refractionVS = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;

      void main() {
        gl_Position = vec4(a_position, 0, 1);
        v_texCoord = (a_position + 1.0) * 0.5;
      }
    `;

    const refractionFS = `
      precision highp float;
      uniform sampler2D u_metaballs;
      uniform sampler2D u_background;
      uniform vec2 u_resolution;
      uniform float u_threshold;
      uniform float u_refractionStrength;
      uniform float u_chromaticAberration;
      uniform vec3 u_color0;
      uniform vec3 u_color1;
      uniform vec3 u_color2;
      uniform vec3 u_color3;
      uniform float u_time;
      uniform float u_lightIntensity;
      uniform float u_absorption;
      uniform int u_materialMode; // 0=water, 1=metal, 2=paint
      varying vec2 v_texCoord;

      // ACES Tonemapping
      vec3 ACESFilm(vec3 x) {
        float a = 2.51;
        float b = 0.03;
        float c = 2.43;
        float d = 0.59;
        float e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
      }

      // PBR utility functions
      float DistributionGGX(vec3 N, vec3 H, float roughness) {
        float a = roughness * roughness;
        float a2 = a * a;
        float NdotH = max(dot(N, H), 0.0);
        float NdotH2 = NdotH * NdotH;
        
        float num = a2;
        float denom = (NdotH2 * (a2 - 1.0) + 1.0);
        denom = 3.14159265 * denom * denom;
        
        return num / denom;
      }

      float GeometrySchlickGGX(float NdotV, float roughness) {
        float r = (roughness + 1.0);
        float k = (r * r) / 8.0;
        
        float num = NdotV;
        float denom = NdotV * (1.0 - k) + k;
        
        return num / denom;
      }

      float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
        float NdotV = max(dot(N, V), 0.0);
        float NdotL = max(dot(N, L), 0.0);
        float ggx2 = GeometrySchlickGGX(NdotV, roughness);
        float ggx1 = GeometrySchlickGGX(NdotL, roughness);
        
        return ggx1 * ggx2;
      }

      vec3 fresnelSchlick(float cosTheta, vec3 F0) {
        return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
      }

      void main() {
        vec4 metaball = texture2D(u_metaballs, v_texCoord);
        
        // Calculate total intensity and per-material intensities
        // float totalIntensity = metaball.r + metaball.g + metaball.b + metaball.a;
        float maxIntensity = max(max(metaball.r, metaball.g), max(metaball.b, metaball.a));
        
        if (maxIntensity < u_threshold) {
          vec3 bg = texture2D(u_background, v_texCoord).rgb;
          bg *= 1.8; // Brighten background too
          gl_FragColor = vec4(ACESFilm(bg), 1.0);
          return;
        }
        
        // Calculate gradient for normals and refraction
        vec2 texelSize = 1.0 / u_resolution;
        vec4 left = texture2D(u_metaballs, v_texCoord - vec2(texelSize.x, 0.0));
        vec4 right = texture2D(u_metaballs, v_texCoord + vec2(texelSize.x, 0.0));
        vec4 top = texture2D(u_metaballs, v_texCoord - vec2(0.0, texelSize.y));
        vec4 bottom = texture2D(u_metaballs, v_texCoord + vec2(0.0, texelSize.y));
        
        float leftMax = max(max(left.r, left.g), max(left.b, left.a));
        float rightMax = max(max(right.r, right.g), max(right.b, right.a));
        float topMax = max(max(top.r, top.g), max(top.b, top.a));
        float bottomMax = max(max(bottom.r, bottom.g), max(bottom.b, bottom.a));
        
        vec2 gradient = vec2(rightMax - leftMax, bottomMax - topMax);
        
        // Calculate surface normal from gradient
        vec3 normal = normalize(vec3(gradient * 2.0, 1.0));
        
        // Height-based effects using total intensity
        float height = maxIntensity;
        float normalizedHeight = smoothstep(u_threshold, 1.0, height);
        
        // Physically-based refraction
        // Calculate surface normal angle relative to view direction
        float normalMagnitude = length(gradient);
        float surfaceAngle = atan(normalMagnitude); // Angle of surface relative to horizontal
        
        // Snell's law approximation: sin(θ₁)/sin(θ₂) = n₁/n₂
        // For liquid (n≈1.33) to air (n≈1.0), critical angle ≈ 48.6°
        float liquidRI = 1.33; // Refractive index of water
        float incidenceAngle = surfaceAngle;
        
        // Calculate refraction based on surface slope, not height
        float refractionStrength = sin(incidenceAngle) * (liquidRI - 1.0) / liquidRI;
        refractionStrength = clamp(refractionStrength, 0.0, 1.0);
        
        // Apply user scaling
        float refractionAmount = u_refractionStrength * refractionStrength;
        vec2 baseRefraction = gradient * refractionAmount;
        
        // Different refractive indices for RGB (red refracts less, blue more)
        float redShift = 0.98;    // Red refracts slightly less
        float greenShift = 1.0;   // Green is baseline
        float blueShift = 1.02;   // Blue refracts slightly more
        
        // Chromatic aberration based on surface angle, not height
        vec2 chromaticOffset = gradient * u_chromaticAberration * refractionStrength;
        
        vec2 redCoord = clamp(v_texCoord + baseRefraction * redShift - chromaticOffset, 0.0, 1.0);
        vec2 greenCoord = clamp(v_texCoord + baseRefraction * greenShift, 0.0, 1.0);
        vec2 blueCoord = clamp(v_texCoord + baseRefraction * blueShift + chromaticOffset, 0.0, 1.0);
        
        vec3 refractedColor = vec3(
          texture2D(u_background, redCoord).r,
          texture2D(u_background, greenCoord).g,
          texture2D(u_background, blueCoord).b
        );
        
        // Determine dominant material color
        vec3 baseColor;
        if (metaball.r > metaball.g && metaball.r > metaball.b && metaball.r > metaball.a) {
          baseColor = u_color0;
        } else if (metaball.g > metaball.b && metaball.g > metaball.a) {
          baseColor = u_color1;
        } else if (metaball.b > metaball.a) {
          baseColor = u_color2;
        } else {
          baseColor = u_color3;
        }
        
        // Set material properties based on material mode
        float roughness;
        float metallic;
        float materialOpacity;
        
        if (u_materialMode == 0) { // Water
          roughness = 0.02;  // Very smooth
          metallic = 0.0;    // Non-metallic
          materialOpacity = 0.2; // Mostly transparent
        } else if (u_materialMode == 1) { // Metal
          roughness = 0.1;   // Smooth
          metallic = 0.9;    // Very metallic
          materialOpacity = 1.0; // Opaque
        } else { // Paint (u_materialMode == 2)
          roughness = 0.8;   // Rough
          metallic = 0.0;    // Non-metallic
          materialOpacity = 0.95; // Nearly opaque
        }
        
        // Absorption based on height/thickness
        float absorption = normalizedHeight * u_absorption;
        vec3 absorptionColor = mix(vec3(1.0), baseColor, absorption);
        
        // Apply absorption to refracted background
        vec3 transmittedColor = refractedColor * absorptionColor;
        
        // PBR Lighting Setup - position-independent
        vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0)); // Fixed light direction
        vec3 viewDir = vec3(0.0, 0.0, 1.0);             // Fixed view direction (looking straight down)
        vec3 halfwayDir = normalize(lightDir + viewDir);
        
        // Calculate F0 for Fresnel
        vec3 F0 = vec3(0.04);
        F0 = mix(F0, baseColor, metallic);
        
        // Calculate radiance - no position-dependent attenuation
        vec3 lightColor = vec3(u_lightIntensity, u_lightIntensity * 0.9, u_lightIntensity * 0.75); // Warm light
        vec3 radiance = lightColor;
        
        // PBR BRDF
        float NDF = DistributionGGX(normal, halfwayDir, roughness);
        float G = GeometrySmith(normal, viewDir, lightDir, roughness);
        vec3 F = fresnelSchlick(max(dot(halfwayDir, viewDir), 0.0), F0);
        
        vec3 kS = F;
        vec3 kD = vec3(1.0) - kS;
        kD *= 1.0 - metallic;
        
        vec3 numerator = NDF * G * F;
        float denominator = 4.0 * max(dot(normal, viewDir), 0.0) * max(dot(normal, lightDir), 0.0) + 0.0001;
        vec3 specular = numerator / denominator;
        
        // Add to outgoing radiance Lo
        float NdotL = max(dot(normal, lightDir), 0.0);
        vec3 Lo = (kD * baseColor / 3.14159265 + specular) * radiance * NdotL;
        
        // Ambient lighting
        vec3 ambient = vec3(0.02) * baseColor;
        
        // Combine specular with transmitted light
        vec3 color = ambient + Lo;
        
        // Mix transmitted background with surface reflection based on material mode
        float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
        float surfaceAlpha = smoothstep(u_threshold, u_threshold + 0.2, maxIntensity);
        
        // Calculate blend factor based on material opacity and fresnel
        float blendFactor = surfaceAlpha * (materialOpacity + (1.0 - materialOpacity) * fresnel);
        
        // Blend transmitted and reflected components
        vec3 finalColor = mix(transmittedColor, color, blendFactor);
        
        // Add rim lighting for extra depth
        float rim = 1.0 - max(dot(normal, viewDir), 0.0);
        rim = pow(rim, 2.0);
        finalColor += baseColor * rim * 0.2 * normalizedHeight;
        
        // Apply exposure boost and ACES tonemapping
        finalColor *= 1.8; // Brighten before tonemapping
        finalColor = ACESFilm(finalColor);
        
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    // Create programs
    this.metaballsProgram = this.createProgram(metaballsVS, metaballsFS);
    this.blurProgram = this.createProgram(blurVS, blurFS);
    this.refractionProgram = this.createProgram(refractionVS, refractionFS);

    // Get uniform locations
    this.getUniformLocations();
  }

  getUniformLocations() {
    // Metaballs uniforms
    this.metaballsUniforms = {
      resolution: this.gl.getUniformLocation(this.metaballsProgram, 'u_resolution'),
      pointSize: this.gl.getUniformLocation(this.metaballsProgram, 'u_pointSize')
    };
    this.metaballsAttribs = {
      position: this.gl.getAttribLocation(this.metaballsProgram, 'a_position'),
      material: this.gl.getAttribLocation(this.metaballsProgram, 'a_material')
    };

    // Blur uniforms
    this.blurUniforms = {
      texture: this.gl.getUniformLocation(this.blurProgram, 'u_texture'),
      texelSize: this.gl.getUniformLocation(this.blurProgram, 'u_texelSize'),
      direction: this.gl.getUniformLocation(this.blurProgram, 'u_direction')
    };
    this.blurAttribs = {
      position: this.gl.getAttribLocation(this.blurProgram, 'a_position')
    };

    // Refraction uniforms
    this.refractionUniforms = {
      metaballs: this.gl.getUniformLocation(this.refractionProgram, 'u_metaballs'),
      background: this.gl.getUniformLocation(this.refractionProgram, 'u_background'),
      resolution: this.gl.getUniformLocation(this.refractionProgram, 'u_resolution'),
      threshold: this.gl.getUniformLocation(this.refractionProgram, 'u_threshold'),
      refractionStrength: this.gl.getUniformLocation(this.refractionProgram, 'u_refractionStrength'),
      chromaticAberration: this.gl.getUniformLocation(this.refractionProgram, 'u_chromaticAberration'),
      time: this.gl.getUniformLocation(this.refractionProgram, 'u_time'),
      lightIntensity: this.gl.getUniformLocation(this.refractionProgram, 'u_lightIntensity'),
      absorption: this.gl.getUniformLocation(this.refractionProgram, 'u_absorption'),
      materialMode: this.gl.getUniformLocation(this.refractionProgram, 'u_materialMode'),
      color0: this.gl.getUniformLocation(this.refractionProgram, 'u_color0'),
      color1: this.gl.getUniformLocation(this.refractionProgram, 'u_color1'),
      color2: this.gl.getUniformLocation(this.refractionProgram, 'u_color2'),
      color3: this.gl.getUniformLocation(this.refractionProgram, 'u_color3')
    };
    this.refractionAttribs = {
      position: this.gl.getAttribLocation(this.refractionProgram, 'a_position')
    };
  }

  setupBuffers() {
    // Fullscreen quad
    const quadVertices = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]);

    this.quadBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, quadVertices, this.gl.STATIC_DRAW);
  }

  createFramebuffer(width, height) {
    const framebuffer = this.gl.createFramebuffer();
    const texture = this.gl.createTexture();

    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, texture, 0);

    return { framebuffer, texture };
  }

  setupBackgroundCanvas() {
    if (!this.backgroundCanvas) {
      this.backgroundCanvas = document.createElement('canvas');
      this.backgroundCtx = this.backgroundCanvas.getContext('2d');
    }

    // Use the same size as the WebGL framebuffers (DPR-adjusted)
    this.backgroundCanvas.width = this.width;
    this.backgroundCanvas.height = this.height;

    // Scale the 2D context for device pixel ratio
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.backgroundCtx.scale(dpr, dpr);

    if (!this.backgroundTexture) {
      this.backgroundTexture = this.gl.createTexture();
    }

    this.backgroundNeedsUpdate = true;
  }

  updateBackground(mode = null) {
    // Use passed mode or stored mode or default to 'hello'
    const currentMode = mode || this.currentMode || 'hello';

    // For clock mode, check if we need to update every second
    if (currentMode === 'clock') {
      const now = Date.now();
      const secondsSinceLastUpdate = Math.floor(now / 1000) - Math.floor(this.lastClockUpdate / 1000);

      if (secondsSinceLastUpdate >= 1) {
        this.backgroundNeedsUpdate = true;
        this.lastClockUpdate = now;
      }
    }

    // For story mode, update every frame for smooth scrolling
    if (currentMode === 'story') {
      this.backgroundNeedsUpdate = true;
    }

    if (!this.backgroundNeedsUpdate) return;

    const ctx = this.backgroundCtx;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;  // Use logical size for drawing
    const h = rect.height;

    // Clear background
    ctx.clearRect(0, 0, w, h);

    // Apply vertical flip to match WebGL coordinate system
    ctx.save();
    ctx.scale(1, -1);
    ctx.translate(0, -h);

    // Draw a nice gradient background (adjusted for flip to keep bright area top-right)
    const gradient = ctx.createLinearGradient(0, h, w, 0);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(0.5, '#16213e');
    gradient.addColorStop(1, '#0f3460');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Add some geometric patterns for refraction interest
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 2;

    // Grid pattern (use logical coordinates)
    for (let x = 0; x < w; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    for (let y = 0; y < h; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Render different content based on mode
    if (currentMode === 'hello') {
      this.renderHelloMode(ctx, w, h);
    } else if (currentMode === 'clock') {
      this.renderClockMode(ctx, w, h);
    } else if (currentMode === 'story') {
      this.renderStoryMode(ctx, w, h, currentMode);
    }

    // Restore the transformation matrix
    ctx.restore();

    // Upload to WebGL texture
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.backgroundTexture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.backgroundCanvas);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    this.backgroundNeedsUpdate = false;
  }

  renderHelloMode(ctx, w, h) {
    // Draw "Hello World!" with randomized gradient and RTL support
    const helloText = window.i18n ? window.i18n.t('helloWorld') : 'Hello World!';

    // Check if current language is RTL
    const isRTL = window.i18n ? window.i18n.isRTL() : false;

    // Calculate font size based on canvas size (responsive)
    const fontSize = Math.min(w, h) * 0.1; // 10% of the smaller dimension

    // Set font with RTL-appropriate font families
    let fontFamily = 'Arial, sans-serif';
    if (isRTL) {
      // Use fonts that better support RTL scripts
      fontFamily = '"Noto Sans Arabic", "Arial Unicode MS", Arial, sans-serif';
    }
    ctx.font = `bold ${fontSize}px ${fontFamily}`;

    // Set text direction and alignment
    ctx.direction = isRTL ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';  // Center works for both LTR and RTL
    ctx.textBaseline = 'middle';

    // Create a randomized gradient for the text
    const time = Date.now() * 0.001; // Slower animation
    const textGradient = ctx.createLinearGradient(
      w * 0.2 + Math.sin(time) * w * 0.1,
      h * 0.2 + Math.cos(time * 0.7) * h * 0.1,
      w * 0.8 + Math.sin(time * 1.3) * w * 0.1,
      h * 0.8 + Math.cos(time * 0.9) * h * 0.1
    );

    // Randomized rainbow colors that change over time
    const hue1 = (time * 30) % 360;
    const hue2 = (time * 25 + 120) % 360;
    const hue3 = (time * 35 + 240) % 360;

    textGradient.addColorStop(0, `hsl(${hue1}, 80%, 70%)`);
    textGradient.addColorStop(0.5, `hsl(${hue2}, 85%, 65%)`);
    textGradient.addColorStop(1, `hsl(${hue3}, 90%, 75%)`);

    // Add text shadow for better visibility - adjust for RTL
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 20;
    // Flip shadow direction for RTL languages
    ctx.shadowOffsetX = isRTL ? -3 : 3;
    ctx.shadowOffsetY = 3;

    // Draw the text
    ctx.fillStyle = textGradient;
    ctx.fillText(helloText, w / 2, h / 2);

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  renderClockMode(ctx, w, h) {
    const now = new Date();
    const time = Date.now() * 0.001;

    // Calculate clock dimensions
    const centerX = w / 2;
    const centerY = h / 2;
    const clockRadius = Math.min(w, h) * 0.35;

    // Draw clock face
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, clockRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Draw hour markers (5-second intervals) - same outer distance, longer inward
    ctx.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6 - Math.PI / 2;
      const x1 = centerX + Math.cos(angle) * clockRadius * 0.95;
      const y1 = centerY + Math.sin(angle) * clockRadius * 0.95;
      const x2 = centerX + Math.cos(angle) * clockRadius * 0.8;
      const y2 = centerY + Math.sin(angle) * clockRadius * 0.8;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Draw minute markers
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    for (let i = 0; i < 60; i++) {
      if (i % 5 !== 0) { // Skip hour markers
        const angle = (i * Math.PI) / 30 - Math.PI / 2;
        const x1 = centerX + Math.cos(angle) * clockRadius * 0.95;
        const y1 = centerY + Math.sin(angle) * clockRadius * 0.95;
        const x2 = centerX + Math.cos(angle) * clockRadius * 0.9;
        const y2 = centerY + Math.sin(angle) * clockRadius * 0.9;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    // Calculate hand angles
    const hours = now.getHours() % 12;
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const milliseconds = now.getMilliseconds();

    // Discrete second hand movement (no smooth animation)
    const discreteSeconds = seconds; // Use discrete seconds, not smooth
    const smoothMinutes = minutes + discreteSeconds / 60;
    const smoothHours = hours + smoothMinutes / 60;

    const hourAngle = (smoothHours * Math.PI) / 6 - Math.PI / 2;
    const minuteAngle = (smoothMinutes * Math.PI) / 30 - Math.PI / 2;
    const secondAngle = (discreteSeconds * Math.PI) / 30 - Math.PI / 2;

    // Draw hour hand
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + Math.cos(hourAngle) * clockRadius * 0.5,
      centerY + Math.sin(hourAngle) * clockRadius * 0.5
    );
    ctx.stroke();

    // Draw minute hand
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + Math.cos(minuteAngle) * clockRadius * 0.7,
      centerY + Math.sin(minuteAngle) * clockRadius * 0.7
    );
    ctx.stroke();

    // Draw second hand with animation
    const secondHandColor = `hsl(${(time * 60) % 360}, 80%, 60%)`;
    ctx.strokeStyle = secondHandColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + Math.cos(secondAngle) * clockRadius * 0.8,
      centerY + Math.sin(secondAngle) * clockRadius * 0.8
    );
    ctx.stroke();

    // Draw center dot
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
    ctx.fill();

    // Draw digital time display
    const timeString = now.toLocaleTimeString();
    const fontSize = Math.min(w, h) * 0.06;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Create gradient for digital time
    const digitalGradient = ctx.createLinearGradient(
      centerX - 100, centerY + clockRadius * 0.6,
      centerX + 100, centerY + clockRadius * 0.6
    );
    digitalGradient.addColorStop(0, `hsl(${(time * 40) % 360}, 70%, 70%)`);
    digitalGradient.addColorStop(1, `hsl(${(time * 40 + 180) % 360}, 70%, 70%)`);

    ctx.fillStyle = digitalGradient;
    ctx.fillText(timeString, centerX, centerY + clockRadius * 0.6);

    // Reset line cap
    ctx.lineCap = 'butt';
  }

  // Method to get clock hand collision data for the simulation
  getClockHandCollisions(w, h) {
    // Use the last clock update time to stay in sync with the background
    const now = new Date(this.lastClockUpdate || Date.now());

    // Calculate clock dimensions (same as renderClockMode)
    const centerX = w / 2;
    const centerY = h / 2;
    const clockRadius = Math.min(w, h) * 0.35;

    // Calculate hand angles (same as renderClockMode)
    const hours = now.getHours() % 12;
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const milliseconds = now.getMilliseconds();

    // Discrete second hand movement (no smooth animation)
    const discreteSeconds = seconds; // Use discrete seconds, not smooth
    const smoothMinutes = minutes + discreteSeconds / 60;
    const smoothHours = hours + smoothMinutes / 60;

    const hourAngle = (smoothHours * Math.PI) / 6 - Math.PI / 2;
    const minuteAngle = (smoothMinutes * Math.PI) / 30 - Math.PI / 2;
    const secondAngle = (discreteSeconds * Math.PI) / 30 - Math.PI / 2;

    // Calculate hand end positions
    const hourHandEnd = {
      x: centerX + Math.cos(hourAngle) * clockRadius * 0.5,
      y: centerY + Math.sin(hourAngle) * clockRadius * 0.5
    };

    const minuteHandEnd = {
      x: centerX + Math.cos(minuteAngle) * clockRadius * 0.7,
      y: centerY + Math.sin(minuteAngle) * clockRadius * 0.7
    };

    const secondHandEnd = {
      x: centerX + Math.cos(secondAngle) * clockRadius * 0.8,
      y: centerY + Math.sin(secondAngle) * clockRadius * 0.8
    };

    // Return collision data for each hand
    return {
      center: { x: centerX, y: centerY },
      clockRadius: clockRadius,
      hourHand: {
        x1: centerX, y1: centerY,
        x2: hourHandEnd.x, y2: hourHandEnd.y,
        thickness: 20
      },
      minuteHand: {
        x1: centerX, y1: centerY,
        x2: minuteHandEnd.x, y2: minuteHandEnd.y,
        thickness: 20
      },
      secondHand: {
        x1: centerX, y1: centerY,
        x2: secondHandEnd.x, y2: secondHandEnd.y,
        thickness: 20
      },
      // Also include the clock face circle for collision
      clockFace: {
        x: centerX, y: centerY,
        radius: clockRadius
      }
    };
  }

  renderStoryMode(ctx, w, h, currentMode = 'story') {
    // Initialize story state if not exists
    if (!this.storyState) {
      this.storyState = {
        scrollPosition: 0,
        lastTime: Date.now(),
        scrollSpeed: 40, // pixels per second - half speed
        storyText: `A long time ago, on a screen far, far away...

Episode IV: THE RETURN OF DEPTH

It is a period of visual rebellion. Designer starships, striking from hidden studios, have won their first victory against the evil FLAT DESIGN EMPIRE.

During the battle, rebel developers managed to steal secret plans to the Empire's ultimate weapon, the MINIMALISM STAR, an interface so stripped of visual elements it could render any user experience completely lifeless.

Pursued by the Empire's sinister agents, Princess Skeuomorphia races through the digital cosmos aboard her starship, custodian of the stolen plans that can save her people and restore depth to the galaxy...

For too long, the Empire had ruled with iron fist and solid colors. Gone were the days of leather textures, wooden panels, and metal buttons that users could almost feel beneath their fingertips. The Dark Lord of Flat, Darth Minimalist, had decreed that all interfaces must be perfectly flat, devoid of shadows, gradients, or any hint of the third dimension.

But hope remained in the outer systems. The rebel developers discovered ancient artifacts called GLASSMORPHISM and LIQUID LAYERS - powerful tools that bend light itself, creating interfaces that shimmer with life. These mystical technologies could layer translucent materials, each with its own refractive index, creating depth through transparency rather than shadow.

As the rebels experimented with these forbidden arts, they learned to make buttons that seemed to float in liquid mercury, cards that appeared suspended in crystalline amber, and navigation elements that rippled like oil on water. Each layer responded to touch with subtle physics, creating interfaces that felt alive.

The Empire struck back with propaganda about "clean design" and "cognitive load," but users began to hunger for beauty once more. A secret research collective, working in hidden laboratories across the digital realm, perfected the ancient LIQUID GLASS techniques. Their prototypes showed interfaces where multiple fluid layers could coexist, each with different densities and surface tensions, creating a depth that was both functional and mesmerizing.

Now, as Princess Skeuomorphia's ship enters the final battle, she carries not just stolen plans, but the hopes of designers everywhere who dream of interfaces that dance with light, shimmer with possibility, and remember that technology should be beautiful as well as functional.

The age of LIQUID GLASS has begun, and with it, the restoration of visual depth to the galaxy...`
      };
    }

    // Calculate delta time for frame-rate independent scrolling
    const currentTime = Date.now();
    const deltaTime = Math.min(Math.max((currentTime - this.storyState.lastTime) / 1000, 1 / 240), 1 / 30); // Clamp between 30fps and 240fps
    this.storyState.lastTime = currentTime;

    // Update scroll position
    this.storyState.scrollPosition += this.storyState.scrollSpeed * deltaTime;

    // Set up text properties
    const fontSize = Math.min(w, h) * 0.04;
    const lineHeight = fontSize * 1.6;

    ctx.font = `${fontSize}px "Papyrus", "Arial", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Create gradient for the classic Star Wars yellow text
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(255, 232, 31, 1)'); // Star Wars yellow
    gradient.addColorStop(0.5, 'rgba(255, 255, 150, 1)');
    gradient.addColorStop(1, 'rgba(255, 232, 31, 1)');

    ctx.fillStyle = gradient;

    // Add drop shadow for better readability
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = -4;

    // Split text into lines and draw
    const lines = this.storyState.storyText.split('\n');
    const maxWidth = w * 0.8;
    let currentY = h - this.storyState.scrollPosition;

    lines.forEach(line => {
      if (line.trim() === '') {
        // Empty line - just add spacing
        currentY += lineHeight;
      } else {
        // Draw wrapped text
        const wrappedLines = this.wrapText(ctx, line, maxWidth);
        wrappedLines.forEach(wrappedLine => {
          // Only draw if visible on screen
          if (currentY > -lineHeight && currentY < h + lineHeight) {
            ctx.fillText(wrappedLine, w / 2, currentY);
          }
          currentY += lineHeight;
        });
      }
    });

    // Calculate total text height for looping
    const totalHeight = currentY + this.storyState.scrollPosition - h;

    // Loop the scroll when it reaches the end
    if (this.storyState.scrollPosition > totalHeight + h) {
      this.storyState.scrollPosition = 0;
    }

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  // Helper function to wrap text
  wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const testLine = currentLine + words[i] + ' ';
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine !== '') {
        lines.push(currentLine.trim());
        currentLine = words[i] + ' ';
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine.trim() !== '') {
      lines.push(currentLine.trim());
    }

    return lines;
  }

  // Helper function to draw wrapped text
  drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let currentY = y;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;

      if (testWidth > maxWidth && n > 0) {
        ctx.fillText(line, x, currentY);
        line = words[n] + ' ';
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;

    // Clean up old framebuffers
    if (this.metaballsFramebuffer) {
      this.gl.deleteFramebuffer(this.metaballsFramebuffer.framebuffer);
      this.gl.deleteTexture(this.metaballsFramebuffer.texture);
    }
    if (this.blurFramebuffer1) {
      this.gl.deleteFramebuffer(this.blurFramebuffer1.framebuffer);
      this.gl.deleteTexture(this.blurFramebuffer1.texture);
    }
    if (this.blurFramebuffer2) {
      this.gl.deleteFramebuffer(this.blurFramebuffer2.framebuffer);
      this.gl.deleteTexture(this.blurFramebuffer2.texture);
    }

    // Create new framebuffers
    this.metaballsFramebuffer = this.createFramebuffer(width, height);
    this.blurFramebuffer1 = this.createFramebuffer(width, height);
    this.blurFramebuffer2 = this.createFramebuffer(width, height);

    // Setup background canvas
    this.setupBackgroundCanvas();

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  beginMetaballsRender(pointSize) {
    // Setup framebuffer and rendering state once for all batches
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.metaballsFramebuffer.framebuffer);
    this.gl.viewport(0, 0, this.width, this.height);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE);

    this.gl.useProgram(this.metaballsProgram);
    // Use logical screen coordinates for shader resolution
    const rect = this.canvas.getBoundingClientRect();
    this.gl.uniform2f(this.metaballsUniforms.resolution, rect.width, rect.height);
    this.gl.uniform1f(this.metaballsUniforms.pointSize, pointSize);

    // Enable vertex attributes once
    this.gl.enableVertexAttribArray(this.metaballsAttribs.position);
    this.gl.enableVertexAttribArray(this.metaballsAttribs.material);
  }

  renderMetaballsBatch(positionBuffer, materialBuffer, numParticles) {
    // Just render this batch with minimal overhead
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
    this.gl.vertexAttribPointer(this.metaballsAttribs.position, 2, this.gl.FLOAT, false, 0, 0);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, materialBuffer);
    this.gl.vertexAttribPointer(this.metaballsAttribs.material, 1, this.gl.UNSIGNED_BYTE, false, 0, 0);

    this.gl.drawArrays(this.gl.POINTS, 0, numParticles);
  }

  endMetaballsRender() {
    // Clean up vertex attributes once after all batches
    this.gl.disableVertexAttribArray(this.metaballsAttribs.position);
    this.gl.disableVertexAttribArray(this.metaballsAttribs.material);
  }

  applyBlur() {
    this.gl.useProgram(this.blurProgram);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.vertexAttribPointer(this.blurAttribs.position, 2, this.gl.FLOAT, false, 0, 0);
    this.gl.enableVertexAttribArray(this.blurAttribs.position);

    this.gl.uniform1i(this.blurUniforms.texture, 0);
    this.gl.uniform2f(this.blurUniforms.texelSize, 1.0 / this.width, 1.0 / this.height);

    // Horizontal blur pass
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.blurFramebuffer1.framebuffer);
    this.gl.viewport(0, 0, this.width, this.height);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.metaballsFramebuffer.texture);
    this.gl.uniform2f(this.blurUniforms.direction, 1.0, 0.0);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

    // Vertical blur pass
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.blurFramebuffer2.framebuffer);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.blurFramebuffer1.texture);
    this.gl.uniform2f(this.blurUniforms.direction, 0.0, 1.0);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

    this.gl.disableVertexAttribArray(this.blurAttribs.position);
  }

  renderRefraction(colors, threshold = 0.3, refractionStrength = 0.02, chromaticAberration = 0.003, lightIntensity = 2.0, absorption = 0.8, materialMode = 'water', liquidGlassMode = 'hello') {
    this.updateBackground(liquidGlassMode);

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this.gl.disable(this.gl.BLEND);

    this.gl.useProgram(this.refractionProgram);

    // Bind textures
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.blurFramebuffer2.texture);
    this.gl.uniform1i(this.refractionUniforms.metaballs, 0);

    this.gl.activeTexture(this.gl.TEXTURE1);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.backgroundTexture);
    this.gl.uniform1i(this.refractionUniforms.background, 1);

    // Set uniforms - use logical screen coordinates
    const rect = this.canvas.getBoundingClientRect();
    this.gl.uniform2f(this.refractionUniforms.resolution, rect.width, rect.height);
    this.gl.uniform1f(this.refractionUniforms.threshold, threshold);
    this.gl.uniform1f(this.refractionUniforms.refractionStrength, refractionStrength);
    this.gl.uniform1f(this.refractionUniforms.chromaticAberration, chromaticAberration);
    this.gl.uniform1f(this.refractionUniforms.time, performance.now() / 1000.0);
    this.gl.uniform1f(this.refractionUniforms.lightIntensity, lightIntensity);
    this.gl.uniform1f(this.refractionUniforms.absorption, absorption);

    // Convert material mode string to integer
    let materialModeInt = 0; // water
    if (materialMode === 'metal') materialModeInt = 1;
    else if (materialMode === 'paint') materialModeInt = 2;
    this.gl.uniform1i(this.refractionUniforms.materialMode, materialModeInt);
    this.gl.uniform3fv(this.refractionUniforms.color0, colors[0]);
    this.gl.uniform3fv(this.refractionUniforms.color1, colors[1]);
    this.gl.uniform3fv(this.refractionUniforms.color2, colors[2]);
    this.gl.uniform3fv(this.refractionUniforms.color3, colors[3]);

    // Render fullscreen quad
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.vertexAttribPointer(this.refractionAttribs.position, 2, this.gl.FLOAT, false, 0, 0);
    this.gl.enableVertexAttribArray(this.refractionAttribs.position);

    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

    this.gl.disableVertexAttribArray(this.refractionAttribs.position);
  }

  forceBackgroundUpdate(mode = 'hello') {
    this.backgroundNeedsUpdate = true;
    this.currentMode = mode; // Store the mode for next update
  }

  destroy() {
    // Clean up WebGL resources
    if (this.metaballsFramebuffer) {
      this.gl.deleteFramebuffer(this.metaballsFramebuffer.framebuffer);
      this.gl.deleteTexture(this.metaballsFramebuffer.texture);
    }
    if (this.blurFramebuffer1) {
      this.gl.deleteFramebuffer(this.blurFramebuffer1.framebuffer);
      this.gl.deleteTexture(this.blurFramebuffer1.texture);
    }
    if (this.blurFramebuffer2) {
      this.gl.deleteFramebuffer(this.blurFramebuffer2.framebuffer);
      this.gl.deleteTexture(this.blurFramebuffer2.texture);
    }
    if (this.backgroundTexture) {
      this.gl.deleteTexture(this.backgroundTexture);
    }
    if (this.quadBuffer) {
      this.gl.deleteBuffer(this.quadBuffer);
    }
    if (this.metaballsProgram) {
      this.gl.deleteProgram(this.metaballsProgram);
    }
    if (this.blurProgram) {
      this.gl.deleteProgram(this.blurProgram);
    }
    if (this.refractionProgram) {
      this.gl.deleteProgram(this.refractionProgram);
    }
  }
}

// Export for use in main file
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MetaballsRefraction;
} else {
  window.MetaballsRefraction = MetaballsRefraction;
} 
