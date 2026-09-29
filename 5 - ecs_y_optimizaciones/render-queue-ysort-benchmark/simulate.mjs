// Simple seeded PRNG (mulberry32) so runs are reproducible across methods/sizes.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORLD_W = 20000, WORLD_H = 20000;
const CAM_W = 3000, CAM_H = 2000;
const CAM_VX = 17, CAM_VY = 11;

/**
 * @param entitySpeed max units/frame drift per axis per entity. This (relative
 *   to how densely entities are packed along y within the camera) is what
 *   determines how much rank-order churn the reinsert method has to fix up
 *   each frame — see README "density vs. speed" note.
 * @returns {{ yFrames: Float32Array[], visFrames: {ids: Uint32Array, len: number}[], maxVisible: number, avgVisible: number }}
 */
export function simulate(N, frameCount, seed = 12345, entitySpeed = 3) {
  const rnd = mulberry32(seed);

  const x = new Float32Array(N);
  const y = new Float32Array(N);
  const vx = new Float32Array(N);
  const vy = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    x[i] = rnd() * WORLD_W;
    y[i] = rnd() * WORLD_H;
    vx[i] = (rnd() * 2 - 1) * entitySpeed;
    vy[i] = (rnd() * 2 - 1) * entitySpeed;
  }

  let camX = WORLD_W * 0.5 - CAM_W * 0.5;
  let camY = WORLD_H * 0.5 - CAM_H * 0.5;
  let camVX = CAM_VX, camVY = CAM_VY;

  const yFrames = [];
  const visFrames = [];
  const scratchVis = new Uint32Array(N);
  let maxVisible = 0, totalVisible = 0;

  for (let f = 0; f < frameCount; f++) {
    for (let i = 0; i < N; i++) {
      x[i] += vx[i];
      y[i] += vy[i];
    }

    camX += camVX; camY += camVY;
    if (camX < 0 || camX + CAM_W > WORLD_W) { camVX = -camVX; camX = Math.max(0, Math.min(camX, WORLD_W - CAM_W)); }
    if (camY < 0 || camY + CAM_H > WORLD_H) { camVY = -camVY; camY = Math.max(0, Math.min(camY, WORLD_H - CAM_H)); }

    const minX = camX, maxX = camX + CAM_W, minY = camY, maxY = camY + CAM_H;
    let len = 0;
    for (let i = 0; i < N; i++) {
      if (x[i] >= minX && x[i] <= maxX && y[i] >= minY && y[i] <= maxY) {
        scratchVis[len++] = i;
      }
    }

    yFrames.push(y.slice()); // snapshot, y keeps changing next frame
    visFrames.push({ ids: scratchVis.slice(0, len), len });
    if (len > maxVisible) maxVisible = len;
    totalVisible += len;
  }

  return { yFrames, visFrames, maxVisible, avgVisible: totalVisible / frameCount };
}
