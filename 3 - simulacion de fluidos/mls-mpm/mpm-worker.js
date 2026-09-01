"use strict";
const BOUND = 3;
const MAX_SPEED = 80;
const MAX_SPEED2 = MAX_SPEED * MAX_SPEED;
const MAX_P = 20000;

let N = 128, DX = 1 / 128, INV = 128;
let RHO0 = 1, PVOL = 0, PMASS = 0;
let DT = 1e-4, GRAV = 9.8, STIFF = 400, GAMMA = 1;
let IRAD = 0.09, ISTR = 1.6, TARGET = 9000, COUNT = 0;

const px = new Float32Array(MAX_P);
const py = new Float32Array(MAX_P);
const vx = new Float32Array(MAX_P);
const vy = new Float32Array(MAX_P);
const C00 = new Float32Array(MAX_P);
const C01 = new Float32Array(MAX_P);
const C10 = new Float32Array(MAX_P);
const C11 = new Float32Array(MAX_P);
const Jp = new Float32Array(MAX_P);

let gvx, gvy, gm;

function allocGrid() {
  const n = N * N;
  gvx = new Float32Array(n);
  gvy = new Float32Array(n);
  gm = new Float32Array(n);
}
function recomputeMass() {
  PVOL = (DX * 0.5) * (DX * 0.5);
  PMASS = PVOL * RHO0;
}
allocGrid();
recomputeMass();

function applyParams(p) {
  if (!p) return;
  if (p.dt != null) DT = p.dt;
  if (p.gravity != null) GRAV = p.gravity;
  if (p.stiffness != null) STIFF = p.stiffness;
  if (p.gamma != null) GAMMA = p.gamma;
  if (p.rho0 != null) { RHO0 = p.rho0; recomputeMass(); }
  if (p.interactRadius != null) IRAD = p.interactRadius;
  if (p.interactStrength != null) ISTR = p.interactStrength;
  if (p.targetParticles != null) TARGET = p.targetParticles | 0;
  if (p.nGrid != null && (p.nGrid | 0) !== N) {
    N = p.nGrid | 0;
    DX = 1 / N;
    INV = N;
    allocGrid();
    recomputeMass();
  }
}

function seed(start, count, x0, y0, x1, y1, vx0, vy0) {
  const aspect = Math.max(0.05, (x1 - x0) / (y1 - y0));
  const cols = Math.max(1, Math.round(Math.sqrt(count * aspect)));
  const rows = Math.max(1, Math.ceil(count / cols));
  let p = start;
  const end = Math.min(MAX_P, start + count);
  outer: for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (p >= end) break outer;
      px[p] = x0 + ((i + 0.5) / cols) * (x1 - x0) + (Math.random() - 0.5) * 0.5 * ((x1 - x0) / cols);
      py[p] = y0 + ((j + 0.5) / rows) * (y1 - y0) + (Math.random() - 0.5) * 0.5 * ((y1 - y0) / rows);
      vx[p] = vx0; vy[p] = vy0;
      C00[p] = C01[p] = C10[p] = C11[p] = 0;
      Jp[p] = 1;
      p++;
    }
  }
  return p - start;
}

function resetSim() {
  COUNT = Math.min(TARGET, MAX_P);
  seed(0, COUNT, 0.08, 0.10, 0.52, 0.72, 0, 0);
}

function splash() {
  if (COUNT >= MAX_P) return;
  const add = Math.min(1000, MAX_P - COUNT);
  const cx = 0.25 + Math.random() * 0.5;
  seed(COUNT, add, cx - 0.1, 0.80, cx + 0.1, 0.94, (Math.random() - 0.5) * 2, -2);
  COUNT += add;
}

function substep(mouse) {
  const n = N, dx = DX, inv = INV, dt = DT, mass = PMASS, vol = PVOL;
  const stiff = STIFF, gamma = GAMMA, grav = GRAV;
  const inv2 = inv * inv;
  const fourInv2 = 4 * inv2;
  const last = n - BOUND;

  gvx.fill(0); gvy.fill(0); gm.fill(0);

  for (let p = 0; p < COUNT; p++) {
    const xp = px[p] * inv, yp = py[p] * inv;
    let bi = Math.floor(xp - 0.5) | 0;
    let bj = Math.floor(yp - 0.5) | 0;
    if (bi < 0) bi = 0; else if (bi > n - 3) bi = n - 3;
    if (bj < 0) bj = 0; else if (bj > n - 3) bj = n - 3;
    const fx = xp - bi, fy = yp - bj;
    const omx = 1.5 - fx, omy = 1.5 - fy;
    const w0x = 0.5 * omx * omx, w1x = 0.75 - (fx - 1) * (fx - 1), w2x = 0.5 * (fx - 0.5) * (fx - 0.5);
    const w0y = 0.5 * omy * omy, w1y = 0.75 - (fy - 1) * (fy - 1), w2y = 0.5 * (fy - 0.5) * (fy - 0.5);

    let J = Jp[p]; if (J < 0.05) J = 0.05;
    let pressure = gamma === 1 ? stiff * (1 / J - 1) : stiff * (Math.pow(J, -gamma) - 1);
    if (pressure < 0) pressure = 0;

    const stress = dt * 4 * vol * pressure * inv2;
    const a00 = stress + mass * C00[p], a01 = mass * C01[p];
    const a10 = mass * C10[p], a11 = stress + mass * C11[p];
    const vxp = vx[p], vyp = vy[p];
    const d0x = (0 - fx) * dx, d1x = (1 - fx) * dx, d2x = (2 - fx) * dx;
    const d0y = (0 - fy) * dx, d1y = (1 - fy) * dx, d2y = (2 - fy) * dx;
    const r0 = bi * n + bj, r1 = (bi + 1) * n + bj, r2 = (bi + 2) * n + bj;

    let w, idx, dpx, dpy;
    w = w0x * w0y; dpx = d0x; dpy = d0y; idx = r0;
    gvx[idx] += w * (mass * vxp + a00 * dpx + a01 * dpy);
    gvy[idx] += w * (mass * vyp + a10 * dpx + a11 * dpy);
    gm[idx] += w * mass;
    w = w0x * w1y; dpy = d1y; idx = r0 + 1;
    gvx[idx] += w * (mass * vxp + a00 * dpx + a01 * dpy);
    gvy[idx] += w * (mass * vyp + a10 * dpx + a11 * dpy);
    gm[idx] += w * mass;
    w = w0x * w2y; dpy = d2y; idx = r0 + 2;
    gvx[idx] += w * (mass * vxp + a00 * dpx + a01 * dpy);
    gvy[idx] += w * (mass * vyp + a10 * dpx + a11 * dpy);
    gm[idx] += w * mass;
    w = w1x * w0y; dpx = d1x; dpy = d0y; idx = r1;
    gvx[idx] += w * (mass * vxp + a00 * dpx + a01 * dpy);
    gvy[idx] += w * (mass * vyp + a10 * dpx + a11 * dpy);
    gm[idx] += w * mass;
    w = w1x * w1y; dpy = d1y; idx = r1 + 1;
    gvx[idx] += w * (mass * vxp + a00 * dpx + a01 * dpy);
    gvy[idx] += w * (mass * vyp + a10 * dpx + a11 * dpy);
    gm[idx] += w * mass;
    w = w1x * w2y; dpy = d2y; idx = r1 + 2;
    gvx[idx] += w * (mass * vxp + a00 * dpx + a01 * dpy);
    gvy[idx] += w * (mass * vyp + a10 * dpx + a11 * dpy);
    gm[idx] += w * mass;
    w = w2x * w0y; dpx = d2x; dpy = d0y; idx = r2;
    gvx[idx] += w * (mass * vxp + a00 * dpx + a01 * dpy);
    gvy[idx] += w * (mass * vyp + a10 * dpx + a11 * dpy);
    gm[idx] += w * mass;
    w = w2x * w1y; dpy = d1y; idx = r2 + 1;
    gvx[idx] += w * (mass * vxp + a00 * dpx + a01 * dpy);
    gvy[idx] += w * (mass * vyp + a10 * dpx + a11 * dpy);
    gm[idx] += w * mass;
    w = w2x * w2y; dpy = d2y; idx = r2 + 2;
    gvx[idx] += w * (mass * vxp + a00 * dpx + a01 * dpy);
    gvy[idx] += w * (mass * vyp + a10 * dpx + a11 * dpy);
    gm[idx] += w * mass;
  }

  const mgx = mouse.x * inv, mgy = mouse.y * inv;
  const rG = IRAD * inv, rG2 = rG * rG;
  const doI = mouse.down && (mouse.vx !== 0 || mouse.vy !== 0);
  const mvx = mouse.vx * ISTR, mvy = mouse.vy * ISTR;

  for (let i = 0; i < n; i++) {
    const di = i - mgx;
    const row = i * n;
    for (let j = 0; j < n; j++) {
      const idx = row + j;
      const m = gm[idx];
      if (m <= 0) { gvx[idx] = 0; gvy[idx] = 0; continue; }
      let gv = gvx[idx] / m;
      let gw = gvy[idx] / m - dt * grav;
      if (doI) {
        const dj = j - mgy;
        const d2 = di * di + dj * dj;
        if (d2 < rG2 && d2 > 1e-12) {
          const f = 1 - Math.sqrt(d2) / rG;
          gv += mvx * f; gw += mvy * f;
        }
      }
      const s2 = gv * gv + gw * gw;
      if (s2 > MAX_SPEED2) {
        const s = MAX_SPEED / Math.sqrt(s2);
        gv *= s; gw *= s;
      }
      if (i < BOUND && gv < 0) gv = 0;
      else if (i > last && gv > 0) gv = 0;
      if (j < BOUND && gw < 0) gw = 0;
      else if (j > last && gw > 0) gw = 0;
      gvx[idx] = gv; gvy[idx] = gw;
    }
  }

  for (let p = 0; p < COUNT; p++) {
    const xp = px[p] * inv, yp = py[p] * inv;
    let bi = Math.floor(xp - 0.5) | 0;
    let bj = Math.floor(yp - 0.5) | 0;
    if (bi < 0) bi = 0; else if (bi > n - 3) bi = n - 3;
    if (bj < 0) bj = 0; else if (bj > n - 3) bj = n - 3;
    const fx = xp - bi, fy = yp - bj;
    const omx = 1.5 - fx, omy = 1.5 - fy;
    const w0x = 0.5 * omx * omx, w1x = 0.75 - (fx - 1) * (fx - 1), w2x = 0.5 * (fx - 0.5) * (fx - 0.5);
    const w0y = 0.5 * omy * omy, w1y = 0.75 - (fy - 1) * (fy - 1), w2y = 0.5 * (fy - 0.5) * (fy - 0.5);
    const d0x = (0 - fx) * dx, d1x = (1 - fx) * dx, d2x = (2 - fx) * dx;
    const d0y = (0 - fy) * dx, d1y = (1 - fy) * dx, d2y = (2 - fy) * dx;
    const r0 = bi * n + bj, r1 = (bi + 1) * n + bj, r2 = (bi + 2) * n + bj;

    let nvx = 0, nvy = 0, n00 = 0, n01 = 0, n10 = 0, n11 = 0;
    let w, gx, gy, k;
    w = w0x * w0y; gx = gvx[r0]; gy = gvy[r0]; k = fourInv2 * w;
    nvx += w * gx; nvy += w * gy;
    n00 += k * gx * d0x; n01 += k * gx * d0y; n10 += k * gy * d0x; n11 += k * gy * d0y;
    w = w0x * w1y; gx = gvx[r0 + 1]; gy = gvy[r0 + 1]; k = fourInv2 * w;
    nvx += w * gx; nvy += w * gy;
    n00 += k * gx * d0x; n01 += k * gx * d1y; n10 += k * gy * d0x; n11 += k * gy * d1y;
    w = w0x * w2y; gx = gvx[r0 + 2]; gy = gvy[r0 + 2]; k = fourInv2 * w;
    nvx += w * gx; nvy += w * gy;
    n00 += k * gx * d0x; n01 += k * gx * d2y; n10 += k * gy * d0x; n11 += k * gy * d2y;
    w = w1x * w0y; gx = gvx[r1]; gy = gvy[r1]; k = fourInv2 * w;
    nvx += w * gx; nvy += w * gy;
    n00 += k * gx * d1x; n01 += k * gx * d0y; n10 += k * gy * d1x; n11 += k * gy * d0y;
    w = w1x * w1y; gx = gvx[r1 + 1]; gy = gvy[r1 + 1]; k = fourInv2 * w;
    nvx += w * gx; nvy += w * gy;
    n00 += k * gx * d1x; n01 += k * gx * d1y; n10 += k * gy * d1x; n11 += k * gy * d1y;
    w = w1x * w2y; gx = gvx[r1 + 2]; gy = gvy[r1 + 2]; k = fourInv2 * w;
    nvx += w * gx; nvy += w * gy;
    n00 += k * gx * d1x; n01 += k * gx * d2y; n10 += k * gy * d1x; n11 += k * gy * d2y;
    w = w2x * w0y; gx = gvx[r2]; gy = gvy[r2]; k = fourInv2 * w;
    nvx += w * gx; nvy += w * gy;
    n00 += k * gx * d2x; n01 += k * gx * d0y; n10 += k * gy * d2x; n11 += k * gy * d0y;
    w = w2x * w1y; gx = gvx[r2 + 1]; gy = gvy[r2 + 1]; k = fourInv2 * w;
    nvx += w * gx; nvy += w * gy;
    n00 += k * gx * d2x; n01 += k * gx * d1y; n10 += k * gy * d2x; n11 += k * gy * d1y;
    w = w2x * w2y; gx = gvx[r2 + 2]; gy = gvy[r2 + 2]; k = fourInv2 * w;
    nvx += w * gx; nvy += w * gy;
    n00 += k * gx * d2x; n01 += k * gx * d2y; n10 += k * gy * d2x; n11 += k * gy * d2y;

    const s2 = nvx * nvx + nvy * nvy;
    if (s2 > MAX_SPEED2) {
      const s = MAX_SPEED / Math.sqrt(s2);
      nvx *= s; nvy *= s;
    }
    vx[p] = nvx; vy[p] = nvy;
    let nx = px[p] + dt * nvx, ny = py[p] + dt * nvy;
    if (nx < 0.002) nx = 0.002; else if (nx > 0.998) nx = 0.998;
    if (ny < 0.002) ny = 0.002; else if (ny > 0.998) ny = 0.998;
    px[p] = nx; py[p] = ny;
    let J = Jp[p] * (1 + dt * (n00 + n11));
    if (J < 0.3) J = 0.3; else if (J > 3) J = 3;
    Jp[p] = J;
    C00[p] = n00; C01[p] = n01; C10[p] = n10; C11[p] = n11;
  }
}

function pack() {
  const out = new Float32Array(COUNT * 3);
  for (let p = 0, o = 0; p < COUNT; p++, o += 3) {
    out[o] = px[p];
    out[o + 1] = py[p];
    const a = vx[p], b = vy[p];
    out[o + 2] = Math.sqrt(a * a + b * b);
  }
  return out;
}

self.onmessage = function (e) {
  const m = e.data;
  if (m.type === "init") {
    applyParams(m.params);
    resetSim();
    self.postMessage({ type: "ready", count: COUNT });
  } else if (m.type === "params") {
    applyParams(m.params);
  } else if (m.type === "reset") {
    applyParams(m.params);
    resetSim();
  } else if (m.type === "splash") {
    splash();
  } else if (m.type === "tick") {
    const t0 = performance.now();
    const steps = m.substeps | 0;
    for (let s = 0; s < steps; s++) substep(m.mouse);
    const packed = pack();
    self.postMessage({ type: "frame", count: COUNT, simMs: performance.now() - t0, data: packed.buffer }, [packed.buffer]);
  }
};