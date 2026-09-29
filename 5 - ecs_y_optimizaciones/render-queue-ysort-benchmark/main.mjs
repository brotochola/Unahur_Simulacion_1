import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulate } from "./simulate.mjs";
import {
  makeRadixScratch, radixSortQueueJs,
  makeReinsertState, reinsertUpdateQueueJs,
} from "./renderQueueAlgosJs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmBytes = fs.readFileSync(path.join(__dirname, "build/renderqueue.wasm"));
const wasmModule = await WebAssembly.compile(wasmBytes);

const SIZES = [10_000, 50_000, 100_000, 200_000];
const FRAME_COUNT = 200;
const WARMUP_FRAMES = 15; // discard cold-start + let JIT warm up before collecting stats

function churnStats(visFrames) {
  let totalChurn = 0, frames = 0;
  let prev = null;
  for (const { ids, len } of visFrames) {
    if (prev) {
      const prevSet = prev.set;
      let entered = 0;
      const curSet = new Set();
      for (let i = 0; i < len; i++) {
        curSet.add(ids[i]);
        if (!prevSet.has(ids[i])) entered++;
      }
      let exited = 0;
      for (const id of prevSet) if (!curSet.has(id)) exited++;
      totalChurn += entered + exited;
      frames++;
      prev = { set: curSet };
    } else {
      const s = new Set();
      for (let i = 0; i < len; i++) s.add(ids[i]);
      prev = { set: s };
    }
  }
  return frames ? totalChurn / frames : 0;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function checksum(ids, len) {
  let sum = 0, xor = 0;
  for (let i = 0; i < len; i++) { sum = (sum + ids[i]) >>> 0; xor ^= ids[i]; }
  return sum + "/" + xor;
}
function isSortedByY(ids, len, yView) {
  for (let i = 1; i < len; i++) if (yView[ids[i - 1]] > yView[ids[i]]) return false;
  return true;
}

async function makeWasmInstance(N) {
  // size against a throwaway 1-page memory (requiredBytes touches no memory)
  const tmpMem = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  const tmpInstance = await WebAssembly.instantiate(wasmModule, { env: { memory: tmpMem } });
  const bytes = tmpInstance.exports.requiredBytes(N);
  const pages = Math.ceil(bytes / 65536);
  const memory = new WebAssembly.Memory({ initial: pages, maximum: pages, shared: true });
  const instance = await WebAssembly.instantiate(wasmModule, { env: { memory } });
  const yView = new Float32Array(memory.buffer, 0, N);
  const curVisView = new Uint32Array(memory.buffer, N * 4, N);
  return { instance, yView, curVisView, memoryBytes: pages * 65536 };
}

async function benchSize(N) {
  console.log(`\n=== N=${N} ===`);
  const sim = simulate(N, FRAME_COUNT);
  const avgChurn = churnStats(sim.visFrames);
  console.log(`  visible/frame: avg=${sim.avgVisible.toFixed(0)} max=${sim.maxVisible}  churn/frame: avg=${avgChurn.toFixed(0)} (${(100 * avgChurn / sim.avgVisible).toFixed(1)}% of visible)`);

  const results = {};

  // ---- js-radix ----
  {
    const scratch = makeRadixScratch(N);
    const queueOut = new Uint32Array(N);
    const times = [];
    let ok = true;
    for (let f = 0; f < FRAME_COUNT; f++) {
      const { ids, len } = sim.visFrames[f];
      const yView = sim.yFrames[f];
      const t0 = process.hrtime.bigint();
      radixSortQueueJs(yView, ids, len, scratch, queueOut);
      const t1 = process.hrtime.bigint();
      if (!isSortedByY(queueOut, len, yView)) ok = false;
      if (checksum(queueOut, len) !== checksum(ids, len)) ok = false;
      if (f >= WARMUP_FRAMES) times.push(Number(t1 - t0) / 1e6);
    }
    results.js_radix = { times, ok };
  }

  // ---- js-reinsert ----
  {
    const state = makeReinsertState(N, N);
    const times = [];
    let ok = true;
    for (let f = 0; f < FRAME_COUNT; f++) {
      const { ids, len } = sim.visFrames[f];
      const yView = sim.yFrames[f];
      const t0 = process.hrtime.bigint();
      const newLen = reinsertUpdateQueueJs(yView, ids, len, state);
      const t1 = process.hrtime.bigint();
      if (newLen !== len) ok = false;
      if (!isSortedByY(state.order, newLen, yView)) ok = false;
      if (checksum(state.order, newLen) !== checksum(ids, len)) ok = false;
      if (f >= WARMUP_FRAMES) times.push(Number(t1 - t0) / 1e6);
    }
    results.js_reinsert = { times, ok };
  }

  // ---- wasm-radix ----
  {
    const { instance, yView, curVisView } = await makeWasmInstance(N);
    const queueView = new Uint32Array(instance.exports.memory.buffer, N * 4 + N * 4, N);
    const times = [];
    let ok = true;
    for (let f = 0; f < FRAME_COUNT; f++) {
      const { ids, len } = sim.visFrames[f];
      const frameY = sim.yFrames[f];
      yView.set(frameY);
      curVisView.set(ids.subarray(0, len));
      const t0 = process.hrtime.bigint();
      instance.exports.radixSortQueue(N, len);
      const t1 = process.hrtime.bigint();
      if (!isSortedByY(queueView, len, frameY)) ok = false;
      if (checksum(queueView, len) !== checksum(ids, len)) ok = false;
      if (f >= WARMUP_FRAMES) times.push(Number(t1 - t0) / 1e6);
    }
    results.wasm_radix = { times, ok };
  }

  // ---- wasm-reinsert ----
  {
    const { instance, yView, curVisView } = await makeWasmInstance(N);
    const queueView = new Uint32Array(instance.exports.memory.buffer, N * 4 + N * 4, N);
    const times = [];
    let ok = true;
    let prevLen = 0;
    for (let f = 0; f < FRAME_COUNT; f++) {
      const { ids, len } = sim.visFrames[f];
      const frameY = sim.yFrames[f];
      yView.set(frameY);
      curVisView.set(ids.subarray(0, len));
      const t0 = process.hrtime.bigint();
      const newLen = instance.exports.reinsertUpdateQueue(N, len, prevLen);
      const t1 = process.hrtime.bigint();
      if (newLen !== len) ok = false;
      if (!isSortedByY(queueView, newLen, frameY)) ok = false;
      if (checksum(queueView, newLen) !== checksum(ids, len)) ok = false;
      prevLen = newLen;
      if (f >= WARMUP_FRAMES) times.push(Number(t1 - t0) / 1e6);
    }
    results.wasm_reinsert = { times, ok };
  }

  for (const [name, r] of Object.entries(results)) {
    console.log(
      `  ${name.padEnd(13)} median=${median(r.times).toFixed(4)}ms  mean=${mean(r.times).toFixed(4)}ms  ok=${r.ok}`
    );
  }

  return { N, avgVisible: sim.avgVisible, maxVisible: sim.maxVisible, avgChurn, results };
}

async function main() {
  const all = [];
  for (const N of SIZES) {
    all.push(await benchSize(N));
  }
  fs.writeFileSync(
    path.join(__dirname, "results.json"),
    JSON.stringify(all, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v), 2)
  );
  console.log("\nWrote results.json");
}

main();
