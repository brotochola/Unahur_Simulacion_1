/* Minimal port of water-caves-simulator-2d cell fluid (physics only) + ImageData render. */

const WATER_CELL_SIZE = 1;
const W = 80;
const H = 60;
const UPDATES_PER_FRAME = 2;

// Little-endian ABGR for Uint32Array view of ImageData
const COL_EMPTY = 0xff1a1a1e;
const COL_SOLID = 0xff6a6a72;
const COL_FAUCET = 0xff4dff99;
const COL_SINK = 0xff4dcc66;

class Cell {
  constructor(engine, i, j) {
    this.engine = engine;
    this.i = i;
    this.j = j;
    this.isSolid = false;
    this.fillLevel = 0;
    this.pressure = 0;
    this.fillRate = 0;
    this.sinkRate = 0;
    this.flowX = 0;
    this.flowY = 0;
    this.gloup = 0;
    this.cellTop = null;
    this.cellRight = null;
    this.cellBottom = null;
    this.cellLeft = null;
  }

  step(dt) {
    dt = dt / this.engine.updatesPerFrame;
    this.gloup += dt;

    if (this.isSolid) return;

    this.pressure = (WATER_CELL_SIZE * this.fillLevel) / 5;
    this.flowX *= 0.95;
    this.flowY *= 0.95;

    if (this.cellTop && !this.cellTop.isSolid) {
      this.pressure = this.pressure + this.cellTop.pressure;
    } else {
      let d = 1;
      let searchLeft = true;
      let searchRight = true;
      while (searchLeft || searchRight) {
        if (searchLeft) {
          const searchLeftCell = this.engine.getCell(this.i - d, this.j);
          if (searchLeftCell && !searchLeftCell.isSolid) {
            const above = this.engine.getCell(this.i - d, this.j + 1);
            if (above && !above.isSolid) {
              this.pressure = this.pressure + above.pressure;
              searchLeft = false;
              searchRight = false;
            }
          } else {
            searchLeft = false;
          }
        }
        if (searchRight) {
          const searchRightCell = this.engine.getCell(this.i + d, this.j);
          if (searchRightCell && !searchRightCell.isSolid) {
            const above = this.engine.getCell(this.i + d, this.j + 1);
            if (above && !above.isSolid) {
              this.pressure = this.pressure + above.pressure;
              searchLeft = false;
              searchRight = false;
            }
          } else {
            searchRight = false;
          }
        }
        d++;
      }
    }

    if (this.cellLeft && !this.cellLeft.isSolid && this.cellRight && !this.cellRight.isSolid) {
      this.pressure = this.pressure * 0.4 + this.cellLeft.pressure * 0.3 + this.cellRight.pressure * 0.3;
    } else if (this.cellLeft && !this.cellLeft.isSolid) {
      this.pressure = this.pressure * 0.5 + this.cellLeft.pressure * 0.5;
    } else if (this.cellRight && !this.cellRight.isSolid) {
      this.pressure = this.pressure * 0.5 + this.cellRight.pressure * 0.5;
    }

    this.pressure = Math.max(this.pressure, 0);

    const belowCell = this.engine.getCell(this.i, this.j - 1);
    if (belowCell && !belowCell.isSolid) {
      const flowRate = 60 * dt;
      let transfer = Math.min(this.fillLevel, 1 - belowCell.fillLevel) * flowRate;
      this.fillLevel -= transfer;
      this.flowY -= transfer;
      belowCell.fillLevel += transfer;
    }

    const belowIsFilledOrSolid = !belowCell || belowCell.isSolid || belowCell.fillLevel >= 0.5;

    if (this.cellLeft && !this.cellLeft.isSolid && belowIsFilledOrSolid) {
      if (this.cellLeft.pressure < this.pressure && this.fillLevel > this.cellLeft.fillLevel * 0.9) {
        let transfer = (this.pressure - this.cellLeft.pressure) * 200 * dt;
        transfer = Math.max(0, Math.min(transfer, (this.fillLevel - this.cellLeft.fillLevel * 0.9) / 2));
        this.fillLevel -= transfer;
        this.cellLeft.fillLevel += transfer;
        this.flowX -= transfer;
      }
    }

    if (this.cellRight && !this.cellRight.isSolid && belowIsFilledOrSolid) {
      if (this.cellRight.pressure < this.pressure && this.fillLevel > this.cellRight.fillLevel * 0.9) {
        let transfer = (this.pressure - this.cellRight.pressure) * 200 * dt;
        transfer = Math.max(0, Math.min(transfer, (this.fillLevel - this.cellRight.fillLevel * 0.9) / 2));
        this.fillLevel -= transfer;
        this.cellRight.fillLevel += transfer;
        this.flowX += transfer;
      }
    }

    if (this.fillLevel > 1) {
      const overflow = this.fillLevel - 1;
      let weight = 1;
      if (this.cellTop && !this.cellTop.isSolid) weight += 1;
      if (this.cellRight && !this.cellRight.isSolid) weight += 1;
      if (this.cellLeft && !this.cellLeft.isSolid) weight += 1;

      const transfer = overflow / weight;
      this.fillLevel -= transfer * (weight - 1);

      if (this.cellTop && !this.cellTop.isSolid) {
        this.cellTop.fillLevel += transfer;
        this.flowY += transfer;
      }
      if (this.cellRight && !this.cellRight.isSolid) {
        this.cellRight.fillLevel += transfer;
        this.flowX += transfer;
      }
      if (this.cellLeft && !this.cellLeft.isSolid) {
        this.cellLeft.fillLevel += transfer;
        this.flowX -= transfer;
      }
    }

    const flen = Math.hypot(this.flowX, this.flowY);
    if (flen > 1) {
      this.flowX /= flen;
      this.flowY /= flen;
    }

    if (this.sinkRate > 0) {
      const sinkRateRate = this.sinkRate * (1 + Math.sin(this.gloup * 7) * 0.8);
      const sinkAmount = Math.min(this.fillLevel, sinkRateRate * dt);
      this.fillLevel -= sinkAmount;
    }
    if (this.fillRate > 0) {
      const randomFillRate = this.fillRate * (1 + Math.sin(this.gloup * 7) * 0.8);
      const fillAmount = Math.min(1 - this.fillLevel, randomFillRate * dt);
      this.fillLevel += fillAmount;
    }
  }
}

class Engine {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.updatesPerFrame = UPDATES_PER_FRAME;
    this.cells = [];
    this._ticTac = 0;

    for (let i = 0; i < width; i++) {
      this.cells[i] = [];
      for (let j = 0; j < height; j++) {
        this.cells[i][j] = new Cell(this, i, j);
      }
    }
    this.neighbourize();
  }

  getCell(i, j) {
    if (i < 0 || j < 0 || i >= this.width || j >= this.height) return null;
    return this.cells[i][j];
  }

  neighbourize() {
    for (let i = 0; i < this.width; i++) {
      for (let j = 0; j < this.height; j++) {
        const cell = this.cells[i][j];
        cell.cellLeft = this.getCell(i - 1, j);
        cell.cellRight = this.getCell(i + 1, j);
        cell.cellBottom = this.getCell(i, j - 1);
        cell.cellTop = this.getCell(i, j + 1);
      }
    }
  }

  update(dt) {
    for (let n = 0; n < this.updatesPerFrame; n++) {
      this._ticTac = (this._ticTac + 1) % 2;
      for (let i = 0; i < this.width; i++) {
        const colIndex = this._ticTac === 0 ? i : this.width - 1 - i;
        const column = this.cells[colIndex];
        for (let j = 0; j < this.height; j++) {
          column[j].step(dt);
        }
      }
    }
  }
}

function buildDemo(engine) {
  for (let i = 0; i < engine.width; i++) {
    for (let j = 0; j < engine.height; j++) {
      const edge =
        i === 0 || j === 0 || i === engine.width - 1 || j === engine.height - 1;
      engine.cells[i][j].isSolid = edge;
    }
  }

  const sink = engine.getCell(2, 2);
  if (sink) {
    sink.isSolid = false;
    sink.sinkRate = 2;
  }

  const fill = engine.getCell(engine.width - 3, engine.height - 3);
  if (fill) {
    fill.isSolid = false;
    fill.fillRate = 2;
  }
}

function waterColor(fill) {
  const t = Math.max(0, Math.min(1, fill));
  const r = (30 + 40 * (1 - t)) | 0;
  const g = (90 + 100 * t) | 0;
  const b = (180 + 50 * t) | 0;
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

/** Turbo-ish heatmap 0..1 → ABGR uint32 */
function heatColor(t) {
  t = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (t < 0.25) {
    const u = t / 0.25;
    r = 0;
    g = (u * 80) | 0;
    b = (80 + u * 175) | 0;
  } else if (t < 0.5) {
    const u = (t - 0.25) / 0.25;
    r = 0;
    g = (80 + u * 175) | 0;
    b = (255 - u * 255) | 0;
  } else if (t < 0.75) {
    const u = (t - 0.5) / 0.25;
    r = (u * 255) | 0;
    g = 255;
    b = 0;
  } else {
    const u = (t - 0.75) / 0.25;
    r = 255;
    g = (255 - u * 255) | 0;
    b = 0;
  }
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

// --- bootstrap ---
const canvas = document.getElementById("c");
const overlay = document.getElementById("overlay");
const ctx = canvas.getContext("2d", { alpha: false });
const octx = overlay.getContext("2d");
const imageData = ctx.createImageData(W, H);
const px = new Uint32Array(imageData.data.buffer);

const ui = {
  density: document.getElementById("dbg-density"),
  pressure: document.getElementById("dbg-pressure"),
  vectors: document.getElementById("dbg-vectors"),
  vecScale: document.getElementById("dbg-vec-scale"),
  vecMin: document.getElementById("dbg-vec-min"),
  stride: document.getElementById("dbg-stride"),
  pressMax: document.getElementById("dbg-press-max"),
  brushSize: document.getElementById("brush-size"),
  brushSizeVal: document.getElementById("brush-size-val"),
};

const engine = new Engine(W, H);
buildDemo(engine);

function selectedMaterial() {
  const el = document.querySelector('input[name="brush-mat"]:checked');
  return el ? el.value : "water";
}

function brushExtent() {
  // size 1 → 1×1, 2 → 3×3, 3 → 5×5
  return Math.max(0, (Number(ui.brushSize.value) | 0) - 1);
}

ui.brushSize.addEventListener("input", () => {
  ui.brushSizeVal.textContent = String(ui.brushSize.value);
});

function cellCoordsFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = ((e.clientX - rect.left) / rect.width) * W;
  const sy = ((e.clientY - rect.top) / rect.height) * H;
  const i = Math.floor(sx);
  // sim j=0 is bottom; canvas y=0 is top
  const j = H - 1 - Math.floor(sy);
  return { i, j };
}

function cellFromEvent(e) {
  const { i, j } = cellCoordsFromEvent(e);
  return engine.getCell(i, j);
}

function isEdgeCell(cell) {
  return (
    cell.i === 0 ||
    cell.j === 0 ||
    cell.i === engine.width - 1 ||
    cell.j === engine.height - 1
  );
}

function applyMaterial(cell, material) {
  if (!cell) return;
  if (cell.fillRate || cell.sinkRate) return;
  if (material === "water") {
    if (cell.isSolid) return;
    cell.fillLevel = 1;
    return;
  }
  if (material === "solid") {
    if (isEdgeCell(cell)) return;
    cell.isSolid = true;
    cell.fillLevel = 0;
    return;
  }
  if (material === "erase") {
    if (isEdgeCell(cell)) return;
    cell.isSolid = false;
    cell.fillLevel = 0;
  }
}

function stampBrush(ci, cj, material) {
  const r = brushExtent();
  for (let di = -r; di <= r; di++) {
    for (let dj = -r; dj <= r; dj++) {
      applyMaterial(engine.getCell(ci + di, cj + dj), material);
    }
  }
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

/** @type {{ button: number, material: string } | null} */
let brush = null;
let lastBrushKey = "";

function brushAtEvent(e) {
  if (!brush) return;
  const { i, j } = cellCoordsFromEvent(e);
  if (i < 0 || j < 0 || i >= W || j >= H) return;
  const key = i + "," + j;
  if (key === lastBrushKey) return;
  lastBrushKey = key;
  stampBrush(i, j, brush.material);
}

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0 && e.button !== 2) return;
  const material = e.button === 2 ? "erase" : selectedMaterial();
  brush = { button: e.button, material };
  lastBrushKey = "";
  brushAtEvent(e);
});

window.addEventListener("mousemove", (e) => {
  if (!brush) return;
  const held = brush.button === 0 ? e.buttons & 1 : e.buttons & 2;
  if (!held) {
    brush = null;
    return;
  }
  brushAtEvent(e);
});

window.addEventListener("mouseup", (e) => {
  if (brush && e.button === brush.button) brush = null;
});

function paintCells() {
  const showDensity = ui.density.checked;
  const showPressure = ui.pressure.checked;
  const pressMax = Math.max(0.01, Number(ui.pressMax.value));

  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) {
      const cell = engine.cells[i][j];
      const out = (H - 1 - j) * W + i;
      if (cell.isSolid) {
        px[out] = COL_SOLID;
        continue;
      }
      if (!showDensity && !showPressure) {
        if (cell.fillRate > 0) px[out] = COL_FAUCET;
        else if (cell.sinkRate > 0) px[out] = COL_SINK;
        else if (cell.fillLevel > 0.001) px[out] = waterColor(cell.fillLevel);
        else px[out] = COL_EMPTY;
        continue;
      }
      if (showPressure) {
        px[out] = heatColor(cell.pressure / pressMax);
      } else {
        px[out] = heatColor(cell.fillLevel);
      }
      // mark faucet/sink with a bright corner pixel feel: boost via special color if empty-ish
      if (cell.fillRate > 0 && cell.fillLevel < 0.05) px[out] = COL_FAUCET;
      if (cell.sinkRate > 0 && cell.fillLevel < 0.05) px[out] = COL_SINK;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function paintVectors() {
  const ow = overlay.width;
  const oh = overlay.height;
  octx.clearRect(0, 0, ow, oh);
  if (!ui.vectors.checked) return;

  const scale = Number(ui.vecScale.value);
  const minLen = Number(ui.vecMin.value) / 100;
  const stride = Math.max(1, Number(ui.stride.value) | 0);
  const cellW = ow / W;
  const cellH = oh / H;

  octx.strokeStyle = "rgba(255, 220, 80, 0.9)";
  octx.fillStyle = "rgba(255, 220, 80, 0.9)";
  octx.lineWidth = 1.25;

  for (let i = 0; i < W; i += stride) {
    for (let j = 0; j < H; j += stride) {
      const cell = engine.cells[i][j];
      if (cell.isSolid) continue;
      const fx = cell.flowX;
      // sim +Y is up; canvas +Y is down
      const fy = -cell.flowY;
      const len = Math.hypot(fx, fy);
      if (len < minLen) continue;

      const cx = (i + 0.5) * cellW;
      const cy = (H - 1 - j + 0.5) * cellH;
      const dx = (fx / len) * Math.min(len, 1) * scale;
      const dy = (fy / len) * Math.min(len, 1) * scale;
      const x2 = cx + dx;
      const y2 = cy + dy;

      octx.beginPath();
      octx.moveTo(cx, cy);
      octx.lineTo(x2, y2);
      octx.stroke();

      // arrow head
      const ang = Math.atan2(dy, dx);
      const ah = 4;
      octx.beginPath();
      octx.moveTo(x2, y2);
      octx.lineTo(x2 - ah * Math.cos(ang - 0.4), y2 - ah * Math.sin(ang - 0.4));
      octx.lineTo(x2 - ah * Math.cos(ang + 0.4), y2 - ah * Math.sin(ang + 0.4));
      octx.closePath();
      octx.fill();
    }
  }
}

function paint() {
  paintCells();
  paintVectors();
}

let last = performance.now();

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 1 / 60);

  engine.update(dt);
  paint();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
