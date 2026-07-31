/**
 * physics.js — Difusión Fick (Jacobi ping-pong) + gravedad falling-sand + flowfield lerp.
 *
 * Orden por substep:
 *  1) buildProcessChunkList
 *  2) copyProcessCells(massRead → massWrite) solo chunks en proceso
 *  3) pressureGrid desde massRead
 *  4) calcular J_ij solo con massRead; aplicar en massWrite; escalar si sumJ > exceso
 *  5) swap
 *  6) gravedad in-place sobre massRead
 *  7) lerp flowfield desde flujos reales acumulados
 *  8) cleanup + commitChunkActivity
 */
"use strict";

/** Acumuladores de transferencia real por celda (target del flowfield). Reutilizados. */
let transferAccX = new Float32Array(0);
let transferAccY = new Float32Array(0);
let transferHad = new Uint8Array(0);

function ensurePhysicsScratch() {
  if (transferAccX.length !== TOTAL_CELLS) {
    transferAccX = new Float32Array(TOTAL_CELLS);
    transferAccY = new Float32Array(TOTAL_CELLS);
    transferHad = new Uint8Array(TOTAL_CELLS);
  }
}

/**
 * Un substep físico completo.
 */
function updatePhysicsSubstep() {
  runtime.totalSubstepsExecuted++;
  ensurePhysicsScratch();

  const gs = GRID_SIZE;
  const rest = cfg.restCapacity;
  const D = cfg.diffusion;
  const grav = cfg.gravity;
  const alpha = cfg.lerp;
  const flowInf = cfg.flowInfluence;
  const snapSq = cfg.flowSnapSq;
  const maxMag = cfg.flowMaxMag;
  const maxSq = maxMag * maxMag;
  const tFloor = transferFloor();
  const nDx = NORM_DX;
  const nDy = NORM_DY;
  const invD = INV_DIST;

  buildProcessChunkList();
  if (processChunkCount === 0) return;

  chunkActiveScratch.fill(0);
  clearProcessCellsFloat(transferAccX);
  clearProcessCellsFloat(transferAccY);
  clearProcessCellsByte(transferHad);

  // --- 1) Copia Jacobi: write = read solo en chunks en proceso ---
  copyProcessCells(massRead, massWrite);

  // --- 2) Exceso / presión desde read ---
  forEachProcessCell((x, y, idx) => {
    if (typeGrid[idx] !== WATER) {
      pressureGrid[idx] = 0;
    } else {
      const m = massRead[idx];
      pressureGrid[idx] = m > rest ? m - rest : 0;
    }
  });

  // --- 3) Fick: outflows por celda, leer solo massRead, escribir massWrite ---
  forEachProcessCell((x, y, idx) => {
    if (typeGrid[idx] !== WATER) return;

    const mass = massRead[idx];
    if (mass < rest) return; // bajo reposo: no genera outflow
    if (isDeadMass(mass)) return;

    const Ci = pressureGrid[idx]; // exceso
    if (Ci <= tFloor && flowInf <= 0) return;

    const fx = flowX[idx];
    const fy = flowY[idx];
    let sumJ = 0;

    for (let i = 0; i < 8; i++) {
      outflows[i] = 0;
      const nx = x + DX[i];
      const ny = y + DY[i];
      const nIdx = nx + ny * gs;
      if (typeGrid[nIdx] === SOLID) continue;

      // C_j: exceso del vecino si WATER, 0 si aire (como masa vecino en fórmula ganas)
      // Plan: J = D * (C_i - C_j) * invDist, con C_j = masa vecino cuando se toma como en ganas
      // Equivalente ganas: (exceso_i - mass_j). Usamos massRead del vecino (aire=0).
      const massN = typeGrid[nIdx] === WATER ? massRead[nIdx] : 0;
      const ganas = Ci - massN; // puede ser negativo
      let J = 0;
      if (ganas > 0) {
        J = D * ganas * invD[i];
      }

      // Influencia flowfield: solo celdas >= rest (ya filtradas)
      const dot = fx * nDx[i] + fy * nDy[i];
      const vPush = Math.max(0, dot * flowInf);
      J += vPush;

      if (J > tFloor) {
        outflows[i] = J;
        sumJ += J;
      }
    }

    if (sumJ <= 0) return;

    // No bajar bajo reposo: escalar si hace falta
    const exceso = mass - rest;
    const scale = sumJ > exceso ? exceso / sumJ : 1.0;

    for (let i = 0; i < 8; i++) {
      let J = outflows[i] * scale;
      if (J <= tFloor) continue;

      const nx = x + DX[i];
      const ny = y + DY[i];
      const nIdx = nx + ny * gs;

      massWrite[idx] -= J;
      massWrite[nIdx] += J;
      typeGrid[nIdx] = WATER;

      // Acumular vector de transferencia real (para flowfield)
      transferAccX[idx] += nDx[i] * J;
      transferAccY[idx] += nDy[i] * J;
      transferHad[idx] = 1;

      markChunkAtCell(nx, ny, massWrite[nIdx]);
    }
  });

  // Clamp numérico: nada de masa negativa por error float
  forEachProcessCell((x, y, idx) => {
    if (massWrite[idx] < 0) massWrite[idx] = 0;
  });

  // --- 4) Swap ping/pong ---
  swapMassBuffers();

  // --- 5) Gravedad falling-sand in-place sobre massRead (post-swap) ---
  // Barrido bottom-up para que caiga en cascada dentro del substep.
  if (grav > 0) {
    applyGravityFallingSand(
      grav,
      tFloor,
      transferAccX,
      transferAccY,
      transferHad,
    );
  }

  // --- 6) Flowfield: lerp hacia target de transferencias (o 0) ---
  forEachProcessCell((x, y, idx) => {
    if (typeGrid[idx] !== WATER || isDeadMass(massRead[idx])) {
      flowX[idx] = 0;
      flowY[idx] = 0;
      return;
    }

    let targetFx = 0;
    let targetFy = 0;
    if (transferHad[idx]) {
      targetFx = transferAccX[idx];
      targetFy = transferAccY[idx];
    }

    let vx = flowX[idx] + (targetFx - flowX[idx]) * alpha;
    let vy = flowY[idx] + (targetFy - flowY[idx]) * alpha;
    let lenSq = vx * vx + vy * vy;
    if (lenSq < snapSq) {
      vx = 0;
      vy = 0;
    } else if (maxSq > 0 && lenSq > maxSq) {
      const s = maxMag / Math.sqrt(lenSq);
      vx *= s;
      vy *= s;
    }
    flowX[idx] = vx;
    flowY[idx] = vy;
  });

  // --- 7) Cleanup masa muerta + activity sleep ---
  forEachProcessCell((x, y, idx) => {
    if (typeGrid[idx] !== WATER) return;
    if (isDeadMass(massRead[idx])) {
      typeGrid[idx] = AIR;
      massRead[idx] = 0;
      flowX[idx] = 0;
      flowY[idx] = 0;
      return;
    }
    if (cellWakesChunk(massRead[idx], flowX[idx], flowY[idx])) {
      chunkActiveScratch[chunkIndex((x / CHUNK) | 0, (y / CHUNK) | 0)] = 1;
    }
  });
  commitChunkActivity(true);
}

/**
 * Gravedad estilo falling sand:
 * prioridad abajo → diagonales abajo → laterales (shuffle L/R).
 * Mueve hasta `grav` partículas por celda/substep.
 * Solo celdas con masa; puede mover bajo reposo (la gravedad sí baja el agua).
 *
 * Nota: el plan dice flowfield no saca masa bajo reposo; la gravedad es término aparte
 * y SÍ puede mover masa bajo reposo (como falling sand físico).
 */
function applyGravityFallingSand(grav, tFloor, accX, accY, had) {
  const gs = GRID_SIZE;
  const m = massRead;

  // Iterar chunks activos, bottom-up en Y para cascada
  // Recolectamos rangos de chunks y barreemos Y de mayor a menor
  for (let i = 0; i < processChunkCount; i++) {
    const ci = processChunkList[i];
    const cx = ci % chunksW;
    const cy = (ci / chunksW) | 0;
    const x0 = Math.max(1, cx * CHUNK);
    const y0 = Math.max(1, cy * CHUNK);
    const x1 = Math.min(gs - 2, cx * CHUNK + CHUNK - 1);
    const y1 = Math.min(gs - 2, cy * CHUNK + CHUNK - 1);

    for (let y = y1; y >= y0; y--) {
      // Alternar dirección X por fila (anti-bias)
      const leftToRight = ((runtime.totalSubstepsExecuted + y) & 1) === 0;
      const xStart = leftToRight ? x0 : x1;
      const xEnd = leftToRight ? x1 : x0;
      const xStep = leftToRight ? 1 : -1;

      for (let x = xStart; leftToRight ? x <= xEnd : x >= xEnd; x += xStep) {
        const idx = x + y * gs;
        if (typeGrid[idx] !== WATER) continue;
        let remaining = m[idx];
        if (remaining <= tFloor) continue;

        let budget = Math.min(grav, remaining);

        // Orden de candidatos: down, down-diag (shuffle), laterals (shuffle)
        // Índices en DX/DY: 0=(0,1) down, 1=(1,1), 7=(-1,1), 2=(1,0), 6=(-1,0)
        const flip = Math.random() < 0.5;

        // 1) Abajo
        if (budget > tFloor) {
          budget = tryGravityMove(
            x,
            y,
            idx,
            0,
            1,
            budget,
            tFloor,
            accX,
            accY,
            had,
          );
        }
        // 2) Diagonales abajo
        if (budget > tFloor) {
          if (flip) {
            budget = tryGravityMove(
              x,
              y,
              idx,
              1,
              1,
              budget,
              tFloor,
              accX,
              accY,
              had,
            );
            if (budget > tFloor)
              budget = tryGravityMove(
                x,
                y,
                idx,
                -1,
                1,
                budget,
                tFloor,
                accX,
                accY,
                had,
              );
          } else {
            budget = tryGravityMove(
              x,
              y,
              idx,
              -1,
              1,
              budget,
              tFloor,
              accX,
              accY,
              had,
            );
            if (budget > tFloor)
              budget = tryGravityMove(
                x,
                y,
                idx,
                1,
                1,
                budget,
                tFloor,
                accX,
                accY,
                had,
              );
          }
        }
        // 3) Laterales
        if (budget > tFloor) {
          if (flip) {
            budget = tryGravityMove(
              x,
              y,
              idx,
              1,
              0,
              budget,
              tFloor,
              accX,
              accY,
              had,
            );
            if (budget > tFloor)
              budget = tryGravityMove(
                x,
                y,
                idx,
                -1,
                0,
                budget,
                tFloor,
                accX,
                accY,
                had,
              );
          } else {
            budget = tryGravityMove(
              x,
              y,
              idx,
              -1,
              0,
              budget,
              tFloor,
              accX,
              accY,
              had,
            );
            if (budget > tFloor)
              budget = tryGravityMove(
                x,
                y,
                idx,
                1,
                0,
                budget,
                tFloor,
                accX,
                accY,
                had,
              );
          }
        }
      }
    }
  }
}

/**
 * Intenta mover hasta `budget` hacia (dx,dy). Devuelve budget restante.
 * Actualiza massRead in-place y acumuladores de flowfield.
 */
function tryGravityMove(x, y, idx, dx, dy, budget, tFloor, accX, accY, had) {
  const gs = GRID_SIZE;
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 1 || nx > gs - 2 || ny < 1 || ny > gs - 2) return budget;

  const nIdx = nx + ny * gs;
  if (typeGrid[nIdx] === SOLID) return budget;

  const flow = budget; // falling sand: mueve todo el budget disponible a la primera celda libre
  if (flow <= tFloor) return budget;

  massRead[idx] -= flow;
  massRead[nIdx] += flow;
  typeGrid[nIdx] = WATER;

  // Vector unitario en esa dirección (normalizado por dist)
  const dist = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
  const ux = dx / dist;
  const uy = dy / dist;
  accX[idx] += ux * flow;
  accY[idx] += uy * flow;
  had[idx] = 1;

  markChunkAtCell(nx, ny, massRead[nIdx]);
  return 0; // budget agotado (prioridad: primera dirección válida se lleva todo)
}
