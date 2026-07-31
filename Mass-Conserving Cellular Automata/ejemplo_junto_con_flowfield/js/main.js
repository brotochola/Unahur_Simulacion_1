/**
 * main.js — Bootstrap + loop rAF.
 */
'use strict';

let massDisplayCounter = 0;

function runPhysicsSubstep() {
    if (isGpuSim()) updatePhysicsSubstepGpu();
    else updatePhysicsSubstep();
}

function loop() {
    const frameT0 = performance.now();

    handleMouseInput();

    const simT0 = performance.now();
    if (!flags.isPaused) {
        for (let s = 0; s < cfg.substeps; s++) {
            runtime.currentSubstepIndex = s + 1;
            runPhysicsSubstep();
        }
        document.getElementById('stepDisplay').textContent =
            `Substep: ${cfg.substeps}/${cfg.substeps}`;
    }
    perf.simAccum += performance.now() - simT0;

    document.getElementById('totalStepsDisplay').textContent =
        `Step: ${runtime.totalSubstepsExecuted}`;

    if (isGpuSim()) {
        const el = document.getElementById('chunkDisplay');
        if (el) el.textContent = 'Chunks: GPU';
    }

    if ((massDisplayCounter++ % 15) === 0) {
        const mass = isGpuSim() ? totalMassGpu() : totalMass();
        document.getElementById('massDisplay').textContent =
            `Masa: ${mass.toFixed(2)}`;
    }

    const rendT0 = performance.now();
    render();
    perf.renderAccum += performance.now() - rendT0;

    perf.frameAccum += performance.now() - frameT0;
    perfFrameTick();

    requestAnimationFrame(loop);
}

function boot() {
    allocateGrids(150);
    allocChunkBuffers();
    initRenderer();
    onGridResized();
    initGrid();
    buildProcessChunkList();
    uploadCpuStateToGpu();
    setupUI();
    bindInputEvents();
    document.getElementById('worldDisplay').textContent = `${GRID_SIZE}x${GRID_SIZE}`;
    loop();
}

boot();
