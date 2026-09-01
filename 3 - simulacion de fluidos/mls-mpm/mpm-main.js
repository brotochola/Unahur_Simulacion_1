"use strict";

(function () {
  const DT_STEPS = [2e-5, 3e-5, 5e-5, 7e-5, 1e-4, 1.5e-4, 2e-4, 3e-4, 4e-4];
  const GRID_STEPS = [48, 64, 96, 128, 160, 192];
  const small = window.innerWidth < 640;

  const params = {
    dt: 1e-4,
    gravity: 9.8,
    stiffness: 400,
    gamma: 1,
    rho0: 1,
    interactRadius: 0.09,
    interactStrength: 1.6,
    targetParticles: small ? 4000 : 9000,
    nGrid: GRID_STEPS[small ? 2 : 3]
  };

  let particleSize = 1;
  let trailKeep = 166;
  function setTrail(t) {
    const clearA = 0.9 - t * 0.85;
    trailKeep = Math.max(8, Math.min(250, Math.round((1 - clearA) * 256)));
  }
  setTrail(0.35);

  let paused = false;
  let autoSub = true;
  let manualSub = 8;
  let curSub = 8;

  let mouseDown = false;
  let mouseX = 0.5, mouseY = 0.5;
  let prevMX = 0.5, prevMY = 0.5;
  let mouseVX = 0, mouseVY = 0;
  let frameDt = 1 / 60;

  let drawCount = 0;
  let drawData = new Float32Array(0);
  let lastSimMs = 0;
  let busy = false;

  const canvas = document.getElementById("sim");
  const wrap = document.getElementById("tankWrap");
  const ctx = canvas.getContext("2d", { alpha: false });
  const readout = document.getElementById("readout");
  const $ = (id) => document.getElementById(id);

  let pix = 640;
  let pixels = null;
  let imageData = null;

  const lutR = new Uint8Array(256);
  const lutG = new Uint8Array(256);
  const lutB = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let r, g, b;
    if (t < 0.5) {
      const u = t * 2;
      r = 32 + 32 * u; g = 84 + 116 * u; b = 150 + 105 * u;
    } else {
      const u = (t - 0.5) * 2;
      r = 64 + 161 * u; g = 200 + 48 * u; b = 255;
    }
    lutR[i] = r | 0; lutG[i] = g | 0; lutB[i] = b | 0;
  }

  function resize() {
    const css = wrap.clientWidth || 640;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    pix = Math.min(Math.round(css * dpr), 720);
    canvas.width = pix;
    canvas.height = pix;
    imageData = ctx.createImageData(pix, pix);
    pixels = imageData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 6; pixels[i + 1] = 10; pixels[i + 2] = 16; pixels[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function paint() {
    const data = pixels;
    const keep = trailKeep;
    for (let i = 0; i < data.length; i += 4) {
      let r = (data[i] * keep) >> 8;
      let g = (data[i + 1] * keep) >> 8;
      let b = (data[i + 2] * keep) >> 8;
      if (r < 6) r = 6;
      if (g < 10) g = 10;
      if (b < 16) b = 16;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }

    const n = drawCount;
    const src = drawData;
    const w = pix;
    const radius = Math.max(1, (w / params.nGrid * 0.55 * particleSize + 0.5) | 0);
    const r2 = radius * radius;

    for (let p = 0, o = 0; p < n; p++, o += 3) {
      const sx = (src[o] * w) | 0;
      const sy = ((1 - src[o + 1]) * w) | 0;
      let li = (src[o + 2] * (255 / 6)) | 0;
      if (li > 255) li = 255;
      if (li < 0) li = 0;
      const R = lutR[li], G = lutG[li], B = lutB[li];
      const x0 = sx - radius, x1 = sx + radius, y0 = sy - radius, y1 = sy + radius;
      for (let y = y0; y <= y1; y++) {
        if ((y >>> 0) >= w) continue;
        const dy = y - sy;
        const row = y * w;
        for (let x = x0; x <= x1; x++) {
          if ((x >>> 0) >= w) continue;
          const dx = x - sx;
          if (dx * dx + dy * dy > r2) continue;
          const idx = (row + x) << 2;
          let nr = data[idx] + R; if (nr > 255) nr = 255;
          let ng = data[idx + 1] + G; if (ng > 255) ng = 255;
          let nb = data[idx + 2] + B; if (nb > 255) nb = 255;
          data[idx] = nr; data[idx + 1] = ng; data[idx + 2] = nb;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function makeWorker() {
    const tag = document.getElementById("worker-src");
    if (tag && tag.textContent) {
      const blob = new Blob([tag.textContent], { type: "application/javascript" });
      return new Worker(URL.createObjectURL(blob));
    }
    try { return new Worker("./mpm-worker.js"); } catch (e) { return null; }
  }

  let worker = makeWorker();
  if (!worker) {
    $("telWorker").textContent = "fail";
    readout.textContent = "Worker bloqueado";
    return;
  }
  $("telWorker").textContent = "ok";

  function tick() {
    if (busy || paused) return;
    busy = true;
    worker.postMessage({
      type: "tick",
      substeps: curSub,
      mouse: { down: mouseDown, x: mouseX, y: mouseY, vx: mouseVX, vy: mouseVY }
    });
  }

  worker.onmessage = function (e) {
    const m = e.data;
    if (m.type === "ready") {
      tick();
      return;
    }
    if (m.type === "frame") {
      drawCount = m.count;
      drawData = new Float32Array(m.data);
      lastSimMs = m.simMs;
      busy = false;
      if (!paused) tick();
    }
  };

  worker.onerror = function (err) {
    console.error(err);
    $("telWorker").textContent = "error";
    // Fallback: blob from fetched text (helps some file:// cases when relative Worker fails at runtime)
  };

  worker.postMessage({ type: "init", params: params });

  function coords(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
  }
  wrap.addEventListener("pointerdown", (e) => {
    mouseDown = true;
    const c = coords(e);
    mouseX = prevMX = c[0];
    mouseY = prevMY = c[1];
    mouseVX = mouseVY = 0;
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener("pointermove", (e) => {
    const c = coords(e);
    mouseX = c[0];
    mouseY = c[1];
  });
  function mouseUp() { mouseDown = false; mouseVX = mouseVY = 0; }
  wrap.addEventListener("pointerup", mouseUp);
  wrap.addEventListener("pointercancel", mouseUp);

  function push() { worker.postMessage({ type: "params", params: params }); }
  function fmtDt(v) { return v.toExponential(2) + " s"; }

  $("resetBtn").onclick = () => {
    worker.postMessage({ type: "reset", params: params });
    if (!busy) tick();
  };
  $("splashBtn").onclick = () => worker.postMessage({ type: "splash" });
  $("pauseBtn").onclick = () => {
    paused = !paused;
    $("pauseBtn").textContent = paused ? "Reanudar" : "Pausa";
    $("pauseBtn").setAttribute("aria-pressed", String(paused));
    if (!paused) tick();
  };

  $("gravity").oninput = () => {
    params.gravity = +$("gravity").value;
    $("gravityVal").textContent = params.gravity.toFixed(1);
    push();
  };
  $("stiffness").oninput = () => {
    params.stiffness = +$("stiffness").value;
    $("stiffnessVal").textContent = String(params.stiffness | 0);
    push();
  };
  $("gamma").oninput = () => {
    params.gamma = +$("gamma").value;
    $("gammaVal").textContent = params.gamma.toFixed(1);
    push();
  };
  $("rho0").oninput = () => {
    params.rho0 = +$("rho0").value;
    $("rho0Val").textContent = params.rho0.toFixed(2);
    push();
  };
  $("dt").oninput = () => {
    params.dt = DT_STEPS[+$("dt").value];
    $("dtVal").textContent = fmtDt(params.dt);
    push();
  };
  $("dtVal").textContent = fmtDt(params.dt);

  $("substeps").oninput = () => {
    manualSub = +$("substeps").value;
    curSub = manualSub;
    $("substepsVal").textContent = String(curSub);
    if (autoSub) {
      autoSub = false;
      $("autoBtn").setAttribute("aria-pressed", "false");
      $("substeps").disabled = false;
    }
  };
  $("autoBtn").onclick = () => {
    autoSub = !autoSub;
    $("autoBtn").setAttribute("aria-pressed", String(autoSub));
    $("substeps").disabled = autoSub;
  };

  $("gridRes").onchange = () => {
    params.nGrid = GRID_STEPS[+$("gridRes").value];
    $("gridVal").textContent = params.nGrid + "×" + params.nGrid;
    worker.postMessage({ type: "reset", params: params });
    if (!busy) tick();
  };
  $("particles").onchange = () => {
    params.targetParticles = +$("particles").value;
    $("particlesVal").textContent = params.targetParticles.toLocaleString("es-AR");
    worker.postMessage({ type: "reset", params: params });
    if (!busy) tick();
  };
  $("particles").oninput = () => { $("particlesVal").textContent = $("particles").value; };

  $("radius").oninput = () => {
    params.interactRadius = +$("radius").value;
    $("radiusVal").textContent = params.interactRadius.toFixed(3);
    push();
  };
  $("strength").oninput = () => {
    params.interactStrength = +$("strength").value;
    $("strengthVal").textContent = params.interactStrength.toFixed(1);
    push();
  };
  $("size").oninput = () => {
    particleSize = +$("size").value;
    $("sizeVal").textContent = particleSize.toFixed(2) + "×";
  };
  $("trail").oninput = () => {
    const t = +$("trail").value;
    setTrail(t);
    $("trailVal").textContent = Math.round(t * 100) + "%";
  };

  $("particles").value = params.targetParticles;
  $("particlesVal").textContent = params.targetParticles.toLocaleString("es-AR");
  $("gridRes").value = String(GRID_STEPS.indexOf(params.nGrid));
  $("gridVal").textContent = params.nGrid + "×" + params.nGrid;

  let lastT = performance.now();
  let fpsSmooth = 60;

  function frame(now) {
    const dtMs = now - lastT;
    lastT = now;
    frameDt = Math.max(dtMs / 1000, 1 / 240);
    fpsSmooth += (1000 / Math.max(dtMs, 1) - fpsSmooth) * 0.12;

    mouseVX = (mouseX - prevMX) / frameDt;
    mouseVY = (mouseY - prevMY) / frameDt;
    const m2 = mouseVX * mouseVX + mouseVY * mouseVY;
    if (m2 > 400) {
      const s = 20 / Math.sqrt(m2);
      mouseVX *= s; mouseVY *= s;
    }
    prevMX = mouseX; prevMY = mouseY;

    if (autoSub) {
      if (fpsSmooth < 45 && curSub > 2) curSub--;
      else if (fpsSmooth > 58 && lastSimMs < 14 && curSub < 12) curSub++;
      $("substeps").value = String(curSub);
      $("substepsVal").textContent = String(curSub);
    } else curSub = manualSub;

    if (!busy && !paused) tick();

    const t0 = performance.now();
    paint();
    const renderMs = performance.now() - t0;

    readout.textContent = drawCount.toLocaleString("es-AR") + " · " + Math.round(fpsSmooth) + " fps";
    $("telDt").textContent = fmtDt(params.dt);
    $("telSubsteps").textContent = curSub + (autoSub ? " auto" : "");
    $("telSimMs").textContent = lastSimMs.toFixed(1) + " ms";
    $("telRenderMs").textContent = renderMs.toFixed(1) + " ms";
    $("telFps").textContent = String(Math.round(fpsSmooth));
    $("telParticles").textContent = drawCount.toLocaleString("es-AR");
    $("telGrid").textContent = params.nGrid + "×" + params.nGrid;

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();