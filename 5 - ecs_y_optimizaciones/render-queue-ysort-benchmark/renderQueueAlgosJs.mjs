// Mirrors assembly/renderqueue.ts exactly (same layout logic, plain typed arrays).

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);
function floatBitsToU32(f) {
  _f32[0] = f;
  return _u32[0];
}
function floatFlip(f) {
  const signBit = f >>> 31; // 0 or 1
  const mask = ((-signBit) | 0x80000000) >>> 0;
  return (f ^ mask) >>> 0;
}

export function makeRadixScratch(maxN) {
  return {
    keys: new Uint32Array(maxN),
    payl: new Uint32Array(maxN),
    keys2: new Uint32Array(maxN),
    payl2: new Uint32Array(maxN),
    counts: new Uint32Array(256),
  };
}

export function radixSortQueueJs(yView, curVisible, curLen, scratch, queueOut) {
  const { keys, payl, counts } = scratch;
  let keys2 = scratch.keys2, payl2 = scratch.payl2;

  for (let i = 0; i < curLen; i++) {
    const idx = curVisible[i];
    keys[i] = floatFlip(floatBitsToU32(yView[idx]));
    payl[i] = idx;
  }

  let srcK = keys, srcP = payl, dstK = keys2, dstP = payl2;
  for (let shift = 0; shift < 32; shift += 8) {
    counts.fill(0);
    for (let i = 0; i < curLen; i++) counts[(srcK[i] >>> shift) & 255]++;
    let total = 0;
    for (let i = 0; i < 256; i++) {
      const c = counts[i];
      counts[i] = total;
      total += c;
    }
    for (let i = 0; i < curLen; i++) {
      const kv = srcK[i], pv = srcP[i];
      const b = (kv >>> shift) & 255;
      const pos = counts[b]++;
      dstK[pos] = kv;
      dstP[pos] = pv;
    }
    const tk = srcK; srcK = dstK; dstK = tk;
    const tp = srcP; srcP = dstP; dstP = tp;
  }
  // 4 passes (even) => srcP === payl
  for (let i = 0; i < curLen; i++) queueOut[i] = srcP[i];
}

export function makeReinsertState(N, maxVisible) {
  return {
    order: new Uint32Array(maxVisible),
    orderLen: 0,
    tracked: new Uint8Array(N),
    visNow: new Uint8Array(N),
  };
}

export function reinsertUpdateQueueJs(yView, curVisible, curLen, state) {
  const { order, tracked, visNow } = state;
  const prevLen = state.orderLen;

  for (let i = 0; i < curLen; i++) visNow[curVisible[i]] = 1;

  let newLen = 0;
  for (let i = 0; i < prevLen; i++) {
    const idx = order[i];
    if (visNow[idx] === 1) {
      order[newLen++] = idx;
    } else {
      tracked[idx] = 0;
    }
  }
  for (let i = 0; i < curLen; i++) {
    const idx = curVisible[i];
    if (tracked[idx] === 0) {
      order[newLen++] = idx;
      tracked[idx] = 1;
    }
    visNow[idx] = 0;
  }

  for (let i = 1; i < newLen; i++) {
    const key = order[i];
    const keyY = yView[key];
    let j = i - 1;
    while (j >= 0 && yView[order[j]] > keyY) {
      order[j + 1] = order[j];
      j--;
    }
    order[j + 1] = key;
  }

  state.orderLen = newLen;
  return newLen;
}
