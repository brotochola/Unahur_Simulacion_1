// Renderer software: rasterizador manual en CPU.
//
// En vez de usar APIs del browser para dibujar, calculamos directamente
// qué píxel debe tener qué color, guardamos eso en un ArrayBuffer,
// y lo volcamos al canvas de una sola vez con putImageData().
//
// Pipeline:
//   1. clear()     — llenar el buffer con el color de fondo
//   2. drawRect()  — escribir píxeles de cada sprite en el buffer
//   3. present()   — copiar el buffer al canvas (putImageData)
//
// Ventajas: control total del píxel, zero overhead de la API Canvas 2D
// Desventajas: corre en CPU, sin aceleración GPU

import { RenderQueue } from "./renderQueue.js";

// ─── Motor de píxeles ─────────────────────────────────────────────────────────

class SoftwareRenderer {
  constructor(canvas, width, height) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;

    canvas.width = width;
    canvas.height = height;

    // alpha: false → el browser no necesita calcular compositing, más rápido
    this.ctx = canvas.getContext("2d", { alpha: false });

    // Un único ArrayBuffer compartido por las dos vistas.
    // pixels32 escribe un color completo (4 bytes) en una sola operación.
    // pixels8  es lo que ImageData espera (bytes individuales RGBA).
    // Al compartir el mismo buffer, no hay copia entre ellos.
    this.buffer = new ArrayBuffer(width * height * 4);
    this.pixels32 = new Uint32Array(this.buffer);
    this.pixels8 = new Uint8ClampedArray(this.buffer);
    this.imageData = new ImageData(this.pixels8, width, height);
  }

  // Limpiar la pantalla: llenar todo el buffer con un color.
  // pixels32.fill() es equivalente a memset, muy rápido.
  clear(color = 0xff000000) {
    this.pixels32.fill(color);
  }

  // Escribir un píxel individual con bounds check.
  setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    // Fórmula de linearización: índice = fila * ancho + columna
    this.pixels32[y * this.width + x] = color;
  }

  getPixel(x, y) {
    return this.pixels32[y * this.width + x];
  }

  // Dibujar un rectángulo relleno.
  // Se calculan los límites una sola vez fuera del loop (clamp),
  // y dentro del loop solo hay una escritura de memoria por píxel.
  drawRect(x, y, w, h, color) {
    const startX = Math.max(0, x);
    const startY = Math.max(0, y);
    const endX = Math.min(this.width, x + w);
    const endY = Math.min(this.height, y + h);

    // Hoisting: sacar variables del loop interno para evitar re-lookups
    const width = this.width;
    const pixels32 = this.pixels32;

    for (let py = startY; py < endY; py++) {
      const row = py * width; // offset de la fila, calculado una vez por fila
      for (let px = startX; px < endX; px++) {
        pixels32[row + px] = color;
      }
    }
  }

  // Línea de Bresenham: algoritmo clásico para rasterizar líneas sin floats.
  // Usa solo sumas y restas de enteros.
  drawLine(x0, y0, x1, y1, color) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      this.setPixel(x0, y0, color);

      if (x0 === x1 && y0 === y1) {
        break;
      }

      const e2 = err * 2;

      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }

      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  // Presentar: volcar el buffer al canvas en una sola operación.
  // putImageData es la única llamada al browser en todo el pipeline.
  present() {
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  // Empaquetar RGBA en un Uint32 en formato little-endian.
  //
  // En little-endian, el byte menos significativo va primero en memoria:
  //   memoria: [R, G, B, A]
  //   entero:   R | G<<8 | B<<16 | A<<24
  //
  // El >>> 0 convierte a Uint32 sin signo (evita negativos con A=255).
  static rgba(r, g, b, a = 255) {
    return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
  }
}

// ─── Adaptador ECS ─────────────────────────────────────────────────────────────

// SoftwareRenderSystem implementa el mismo contrato que los otros renderers:
// init(), draw(), registerPool(), viewportWidth, viewportHeight.
// El World no sabe si está usando canvas, Three.js, o este renderer.
export class SoftwareRenderSystem {
  static _sw = null;
  static _canvas = null;
  static _initialized = false;

  // Colores pre-computados una sola vez. No se recalculan en el draw loop.
  static _clearColor = SoftwareRenderer.rgba(26, 26, 46, 255);   // #1a1a2e
  static _spriteColor = SoftwareRenderer.rgba(233, 69, 96, 255); // #e94560

  // Inicialización sincrónica: crea el canvas y el rasterizador.
  static init(viewport) {
    const W = viewport.clientWidth;
    const H = viewport.clientHeight;

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    viewport.appendChild(canvas);

    this._canvas = canvas;
    this._sw = new SoftwareRenderer(canvas, W, H);
    this._initialized = true;
  }

  static get viewportWidth() {
    return this._canvas.width;
  }

  static get viewportHeight() {
    return this._canvas.height;
  }

  // No necesita preparación por pool (sin GPU, sin meshes)
  static registerPool() {}

  // Loop de dibujado: consume la RenderQueue en orden Y-sorteado.
  // Idéntico en estructura a los otros renderers — solo cambia cómo se dibuja.
  static draw() {
    const sw = this._sw;
    sw.clear(this._clearColor);

    const { count, order, poolId, index, pools } = RenderQueue;
    const color = this._spriteColor;

    for (let k = 0; k < count; k++) {
      const i = order[k];           // índice en la cola (Y-sorteado)
      const pool = pools[poolId[i]]; // clase de entidad
      const j = index[i];            // slot compacto en el SoA del pool

      // | 0 trunca a entero: más rápido que Math.floor para coords positivas
      sw.setPixel(pool.x[j] | 0, pool.y[j] | 0, color);
    }

    // Volcar el buffer al canvas
    sw.present();
  }
}
