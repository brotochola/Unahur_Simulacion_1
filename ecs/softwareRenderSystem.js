import { RenderQueue } from "./renderQueue.js";

class SoftwareRenderer {
  constructor(canvas, width, height) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;

    canvas.width = width;
    canvas.height = height;

    this.ctx = canvas.getContext("2d", { alpha: false });

    this.buffer = new ArrayBuffer(width * height * 4);
    this.pixels32 = new Uint32Array(this.buffer);
    this.pixels8 = new Uint8ClampedArray(this.buffer);
    this.imageData = new ImageData(this.pixels8, width, height);
  }

  clear(color = 0xff000000) {
    this.pixels32.fill(color);
  }

  setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    this.pixels32[y * this.width + x] = color;
  }

  getPixel(x, y) {
    return this.pixels32[y * this.width + x];
  }

  drawRect(x, y, w, h, color) {
    const startX = Math.max(0, x);
    const startY = Math.max(0, y);
    const endX = Math.min(this.width, x + w);
    const endY = Math.min(this.height, y + h);
    const width = this.width;
    const pixels32 = this.pixels32;

    for (let py = startY; py < endY; py++) {
      const row = py * width;
      for (let px = startX; px < endX; px++) {
        pixels32[row + px] = color;
      }
    }
  }

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

  present() {
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  static rgba(r, g, b, a = 255) {
    return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
  }
}

export class SoftwareRenderSystem {
  static _sw = null;
  static _canvas = null;
  static _initialized = false;
  static _clearColor = SoftwareRenderer.rgba(26, 26, 46, 255);
  static _spriteColor = SoftwareRenderer.rgba(233, 69, 96, 255);

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

  static registerPool() {}

  static draw() {
    const sw = this._sw;
    sw.clear(this._clearColor);

    const { count, order, poolId, index, pools } = RenderQueue;
    const color = this._spriteColor;

    for (let k = 0; k < count; k++) {
      const i = order[k];
      const pool = pools[poolId[i]];
      const j = index[i];
      sw.setPixel(pool.x[j] | 0, pool.y[j] | 0, color);
    }

    sw.present();
  }
}
