/**
 * main.js — Bootstrap + loop rAF.
 */
'use strict';

let lastFpsTime = performance.now();
let frameCount = 0;
let massDisplayCounter = 0;

function loop() {
    const now = performance.now();
    frameCount++;
    if (now - lastFpsTime >= 500) {
        document.getElementById('fpsDisplay').textContent =
            `${Math.round((frameCount * 1000) / (now - lastFpsTime))} FPS`;
        frameCount = 0;
        lastFpsTime = now;
    }

    handleMouseInput();

    if (!flags.isPaused) {
        for (let s = 0; s < cfg.substeps; s++) {
            runtime.currentSubstepIndex = s + 1;
            updatePhysicsSubstep();
        }
        document.getElementById('stepDisplay').textContent =
            `Substep: ${cfg.substeps}/${cfg.substeps}`;
    }

    document.getElementById('totalStepsDisplay').textContent =
        `Step: ${runtime.totalSubstepsExecuted}`;

    // Actualizar masa total cada ~15 frames (barato)
    if ((massDisplayCounter++ % 15) === 0) {
        document.getElementById('massDisplay').textContent =
            `Masa: ${totalMass().toFixed(2)}`;
    }

    render();
    requestAnimationFrame(loop);
}

function boot() {
    allocateGrids(150);
    allocChunkBuffers();
    initRenderer();
    onGridResized();
    initGrid();
    buildProcessChunkList();
    setupUI();
    bindInputEvents();
    document.getElementById('worldDisplay').textContent = `${GRID_SIZE}x${GRID_SIZE}`;
    loop();
}

boot();
