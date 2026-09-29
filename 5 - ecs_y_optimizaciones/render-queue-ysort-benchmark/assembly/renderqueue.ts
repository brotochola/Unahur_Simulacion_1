// Memory layout for a given entity count N (all offsets in bytes):
//   yOff        : f32[N]   global y positions (updated by the host every frame)
//   curVisOff   : u32[N]   this frame's visible entity ids (from cull, ascending id order)
//   queueOff    : u32[N]   OUTPUT: render queue (ids ascending by y). Also doubles as the
//                          persistent "previous order" for the reinsert method.
//   trackedOff  : u8[N]    reinsert only: 1 if id is currently present in queueOff
//   visNowOff   : u8[N]    reinsert only: transient "visible this frame" scratch flag
//   keysOff     : u32[N]   radix only: flipped float keys
//   paylOff     : u32[N]   radix only: payload (entity id) parallel to keys
//   keyScrOff   : u32[N]   radix only: ping-pong scratch for keys
//   paylScrOff  : u32[N]   radix only: ping-pong scratch for payload
//   countsOff   : u32[256] radix only: counting buckets

@inline
function align4(x: i32): i32 {
  return (x + 3) & ~3;
}

function yOff(N: i32): i32 { return 0; }
function curVisOff(N: i32): i32 { return yOff(N) + (N << 2); }
function queueOff(N: i32): i32 { return curVisOff(N) + (N << 2); }
function trackedOff(N: i32): i32 { return queueOff(N) + (N << 2); }
function visNowOff(N: i32): i32 { return trackedOff(N) + N; }
function keysOff(N: i32): i32 { return align4(visNowOff(N) + N); }
function paylOff(N: i32): i32 { return keysOff(N) + (N << 2); }
function keyScrOff(N: i32): i32 { return paylOff(N) + (N << 2); }
function paylScrOff(N: i32): i32 { return keyScrOff(N) + (N << 2); }
function countsOff(N: i32): i32 { return paylScrOff(N) + (N << 2); }

// Pure arithmetic, safe to call against any (even minimal) memory.
export function requiredBytes(N: i32): i32 {
  return countsOff(N) + 1024;
}

// Michael Herf's float-flip: produces a uint32 whose unsigned ordering
// matches IEEE754 float ordering (handles negatives correctly).
@inline
function floatFlip(f: u32): u32 {
  const mask: u32 = (<u32>(-(<i32>(f >>> 31)))) | 0x80000000;
  return f ^ mask;
}

export function radixSortQueue(N: i32, curLen: i32): void {
  const yBase = yOff(N);
  const cv = curVisOff(N);
  const q = queueOff(N);
  const keys = keysOff(N);
  const payl = paylOff(N);
  const keys2 = keyScrOff(N);
  const payl2 = paylScrOff(N);
  const counts = countsOff(N);

  for (let i = 0; i < curLen; i++) {
    const idx = load<u32>(cv + (i << 2));
    const bits = reinterpret<u32>(load<f32>(yBase + (idx << 2)));
    store<u32>(keys + (i << 2), floatFlip(bits));
    store<u32>(payl + (i << 2), idx);
  }

  let srcK = keys, srcP = payl, dstK = keys2, dstP = payl2;
  for (let shift: i32 = 0; shift < 32; shift += 8) {
    for (let i = 0; i < 256; i++) store<u32>(counts + (i << 2), 0);
    for (let i = 0; i < curLen; i++) {
      const b = (load<u32>(srcK + (i << 2)) >>> shift) & 255;
      const off = counts + (b << 2);
      store<u32>(off, load<u32>(off) + 1);
    }
    let total: u32 = 0;
    for (let i = 0; i < 256; i++) {
      const off = counts + (i << 2);
      const c = load<u32>(off);
      store<u32>(off, total);
      total += c;
    }
    for (let i = 0; i < curLen; i++) {
      const kv = load<u32>(srcK + (i << 2));
      const pv = load<u32>(srcP + (i << 2));
      const b = (kv >>> shift) & 255;
      const off = counts + (b << 2);
      const pos = load<u32>(off);
      store<u32>(dstK + (pos << 2), kv);
      store<u32>(dstP + (pos << 2), pv);
      store<u32>(off, pos + 1);
    }
    const tk = srcK; srcK = dstK; dstK = tk;
    const tp = srcP; srcP = dstP; dstP = tp;
  }
  // 4 passes (even) => srcP is back at `payl`.
  for (let i = 0; i < curLen; i++) {
    store<u32>(q + (i << 2), load<u32>(srcP + (i << 2)));
  }
}

// Updates queueOff in place from prevLen -> curLen using previous frame's
// order as a starting point (coherent insertion sort). Returns the new length.
export function reinsertUpdateQueue(N: i32, curLen: i32, prevLen: i32): i32 {
  const yBase = yOff(N);
  const cv = curVisOff(N);
  const q = queueOff(N);
  const tracked = trackedOff(N);
  const visNow = visNowOff(N);

  for (let i = 0; i < curLen; i++) {
    store<u8>(visNow + load<u32>(cv + (i << 2)), 1);
  }

  let newLen: i32 = 0;
  for (let i = 0; i < prevLen; i++) {
    const idx = load<u32>(q + (i << 2));
    if (load<u8>(visNow + idx) == 1) {
      store<u32>(q + (newLen << 2), idx);
      newLen++;
    } else {
      store<u8>(tracked + idx, 0);
    }
  }

  for (let i = 0; i < curLen; i++) {
    const idx = load<u32>(cv + (i << 2));
    if (load<u8>(tracked + idx) == 0) {
      store<u32>(q + (newLen << 2), idx);
      newLen++;
      store<u8>(tracked + idx, 1);
    }
    store<u8>(visNow + idx, 0);
  }

  for (let i = 1; i < newLen; i++) {
    const key = load<u32>(q + (i << 2));
    const keyY = load<f32>(yBase + (key << 2));
    let j = i - 1;
    while (j >= 0) {
      const vj = load<u32>(q + (j << 2));
      const vjY = load<f32>(yBase + (vj << 2));
      if (vjY <= keyY) break;
      store<u32>(q + ((j + 1) << 2), vj);
      j--;
    }
    store<u32>(q + ((j + 1) << 2), key);
  }

  return newLen;
}
