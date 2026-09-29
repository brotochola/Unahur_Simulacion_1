// Diagnostic script (not part of the main benchmark timing) that shows *why*
// reinsert's relative advantage shrinks as N grows in main.mjs's scenario:
// world size and camera size are fixed, so higher N means higher entity
// density, which means a *fixed* per-frame drift speed crosses more
// neighbours' y-rank each frame. This counts actual insertion-sort shift
// steps (not wall-clock time) to isolate that effect from JIT/GC noise.
import { simulate } from "./simulate.mjs";

const SIZES = [10_000, 50_000, 100_000, 200_000];
const FRAMES = 100;
const WARMUP = 15;

for (const N of SIZES) {
  const sim = simulate(N, FRAMES);
  const order = new Uint32Array(N);
  const tracked = new Uint8Array(N);
  const visNow = new Uint8Array(N);
  let orderLen = 0;
  let totalShifts = 0, frames = 0;

  for (let f = 0; f < FRAMES; f++) {
    const { ids, len } = sim.visFrames[f];
    const yView = sim.yFrames[f];

    for (let i = 0; i < len; i++) visNow[ids[i]] = 1;
    let newLen = 0;
    for (let i = 0; i < orderLen; i++) {
      const idx = order[i];
      if (visNow[idx] === 1) order[newLen++] = idx;
      else tracked[idx] = 0;
    }
    for (let i = 0; i < len; i++) {
      const idx = ids[i];
      if (tracked[idx] === 0) { order[newLen++] = idx; tracked[idx] = 1; }
      visNow[idx] = 0;
    }

    let shifts = 0;
    for (let i = 1; i < newLen; i++) {
      const key = order[i], keyY = yView[key];
      let j = i - 1;
      while (j >= 0 && yView[order[j]] > keyY) { order[j + 1] = order[j]; j--; shifts++; }
      order[j + 1] = key;
    }
    orderLen = newLen;
    if (f >= WARMUP) { totalShifts += shifts; frames++; }
  }

  const avgShifts = totalShifts / frames;
  console.log(
    `N=${String(N).padStart(6)}  avgVisible=${sim.avgVisible.toFixed(0).padStart(5)}  ` +
    `avgShifts/frame=${avgShifts.toFixed(1).padStart(8)}  shifts-per-visible=${(avgShifts / sim.avgVisible).toFixed(3)}`
  );
}
