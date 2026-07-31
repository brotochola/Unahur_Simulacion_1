/**
 * ui.js — Knobs, playback, inspector, presets.
 */
'use strict';

function updateInspectorUI() {
    const mouseX = runtime.mouseX;
    const mouseY = runtime.mouseY;
    if (mouseX < 0 || mouseX >= GRID_SIZE || mouseY < 0 || mouseY >= GRID_SIZE) return;

    const idx = mouseX + mouseY * GRID_SIZE;
    const typeStr = typeGrid[idx] === SOLID ? 'PARED' : (typeGrid[idx] === WATER ? 'AGUA' : 'AIRE');
    const m = massRead[idx];
    const p = (typeGrid[idx] === WATER) ? Math.max(0, m - cfg.restCapacity) : 0;
    const vx = flowX[idx];
    const vy = flowY[idx];
    const mag = Math.sqrt(vx * vx + vy * vy);

    document.getElementById('inspPos').textContent = `X: ${mouseX} | Y: ${mouseY}`;
    document.getElementById('inspType').textContent = typeStr;
    document.getElementById('inspMass').textContent = m.toFixed(4);
    document.getElementById('inspPressure').textContent = p.toFixed(4);
    document.getElementById('inspVec').textContent = `(${vx.toFixed(2)}, ${vy.toFixed(2)})`;
    document.getElementById('inspMag').textContent = mag.toFixed(4);

    vectorCtx.clearRect(0, 0, 140, 40);
    vectorCtx.strokeStyle = '#00f0ff';
    vectorCtx.lineWidth = 2;
    vectorCtx.beginPath();
    vectorCtx.moveTo(70, 20);
    vectorCtx.lineTo(70 + vx * 15, 20 + vy * 15);
    vectorCtx.stroke();
}

/** Preset vaso en U (de Mass-Conserving) — agua a la izquierda */
function loadUTubePreset() {
    initGrid();
    chunkHasWater.fill(0);
    chunkQuiet.fill(0);
    chunkActiveScratch.fill(0);

    const gs = GRID_SIZE;
    const leftX = Math.floor(gs * 0.2);
    const rightX = Math.floor(gs * 0.8);
    const bottomY = Math.floor(gs * 0.85);
    const topY = Math.floor(gs * 0.2);
    const wall = Math.floor(gs * 0.03);
    const width = Math.floor(gs * 0.18);
    const rest = cfg.restCapacity;

    for (let y = topY; y <= bottomY; y++) {
        for (let t = 0; t < wall; t++) {
            typeGrid[(leftX - t) + y * gs] = SOLID;
            typeGrid[(leftX + width + t) + y * gs] = SOLID;
            typeGrid[(rightX - width - t) + y * gs] = SOLID;
            typeGrid[(rightX + t) + y * gs] = SOLID;
        }
    }
    for (let x = leftX - wall; x <= rightX + wall; x++) {
        for (let t = 0; t < wall; t++) {
            typeGrid[x + (bottomY + t) * gs] = SOLID;
        }
    }
    for (let y = topY + 20; y < bottomY; y++) {
        for (let x = leftX + 1; x < leftX + width; x++) {
            const idx = x + y * gs;
            typeGrid[idx] = WATER;
            massRead[idx] = rest;
            markChunkAtCell(x, y, massRead[idx]);
        }
    }
    // Sync pong por si acaso
    massWrite.set(massRead);
    rebuildChunkFlagsFromWater();
    buildProcessChunkList();
    markRenderFullDirty();
}

function reallocateGrid(newSize) {
    allocateGrids(newSize);
    allocChunkBuffers();
    onGridResized();
    initGrid();
    chunkHasWater.fill(0);
    chunkQuiet.fill(0);
    chunkActiveScratch.fill(0);
    buildProcessChunkList();
    markRenderFullDirty();
    document.getElementById('worldDisplay').textContent = `${GRID_SIZE}x${GRID_SIZE}`;
    document.getElementById('inputWorldSize').value = String(GRID_SIZE);
}

function setupUI() {
    const btnPlay = document.getElementById('btnPlayPause');
    btnPlay.onclick = () => {
        flags.isPaused = !flags.isPaused;
        btnPlay.textContent = flags.isPaused ? 'Reanudar' : 'Pausa';
        btnPlay.classList.toggle('active', flags.isPaused);
    };

    document.getElementById('btnStepFrame').onclick = () => {
        flags.isPaused = true;
        btnPlay.textContent = 'Reanudar';
        btnPlay.classList.add('active');
        for (let s = 0; s < cfg.substeps; s++) updatePhysicsSubstep();
    };

    document.getElementById('btnStepSubstep').onclick = () => {
        flags.isPaused = true;
        btnPlay.textContent = 'Reanudar';
        btnPlay.classList.add('active');
        updatePhysicsSubstep();
    };

    document.getElementById('chkFlowfield').onchange = (e) => { flags.showFlowfield = e.target.checked; };
    document.getElementById('chkGrid').onchange = (e) => { flags.showGrid = e.target.checked; };
    document.getElementById('chkChunks').onchange = (e) => { flags.showChunks = e.target.checked; };
    document.getElementById('chkTemporalSmooth').onchange = (e) => {
        flags.useTemporalSmooth = e.target.checked;
        if (flags.useTemporalSmooth) {
            displayMassGrid.set(massRead);
            displayFlowX.set(flowX);
            displayFlowY.set(flowY);
        }
        markRenderFullDirty();
    };
    document.getElementById('chkChunkCulling').onchange = (e) => {
        flags.useChunkCulling = e.target.checked;
        buildProcessChunkList();
        markRenderFullDirty();
    };

    document.getElementById('selectRenderer').onchange = (e) => {
        setRendererBackend(e.target.value);
    };
    document.getElementById('selectRenderMode').onchange = (e) => {
        flags.renderMode = e.target.value;
        markRenderFullDirty();
    };
    document.getElementById('selectChunkSize').onchange = (e) => {
        reconfigureChunks(parseInt(e.target.value, 10));
        markRenderFullDirty();
    };

    const applyWorldSize = () => {
        let n = parseInt(document.getElementById('inputWorldSize').value, 10);
        if (!Number.isFinite(n)) n = 150;
        n = Math.max(32, Math.min(512, n | 0));
        reallocateGrid(n);
    };
    document.getElementById('btnApplyWorld').onclick = applyWorldSize;
    document.getElementById('inputWorldSize').onkeydown = (e) => {
        if (e.key === 'Enter') applyWorldSize();
    };

    const bindKnob = (id, labelId, fn, fmt) => {
        document.getElementById(id).oninput = (e) => {
            const v = parseFloat(e.target.value);
            fn(v);
            document.getElementById(labelId).textContent = fmt ? fmt(v) : v.toFixed(2);
        };
    };

    bindKnob('knobRestCapacity', 'valRestCapacity', v => { cfg.restCapacity = v; });
    bindKnob('knobDiffusion', 'valDiffusion', v => { cfg.diffusion = v; });
    bindKnob('knobGravity', 'valGravity', v => { cfg.gravity = v; });
    bindKnob('knobLerp', 'valLerp', v => { cfg.lerp = v; });
    bindKnob('knobFlowInfluence', 'valFlowInfluence', v => { cfg.flowInfluence = v; });
    bindKnob('knobMinFlow', 'valMinFlow', v => { cfg.minFlow = v; }, v => v.toFixed(4));
    bindKnob('knobFlowSnapSq', 'valFlowSnapSq', v => { cfg.flowSnapSq = v; }, v => v.toFixed(4));
    bindKnob('knobFlowMaxMag', 'valFlowMaxMag', v => { cfg.flowMaxMag = v; });
    bindKnob('knobSubsteps', 'valSubsteps', v => { cfg.substeps = v; }, v => `${v}x`);
    bindKnob('knobBrush', 'valBrush', v => { cfg.brushRadius = v; }, v => `${v}px`);
    bindKnob('knobBrushAmount', 'valBrushAmount', v => { cfg.brushAmount = v; });
    bindKnob('knobFlowDebugScale', 'valFlowDebugScale', v => { cfg.flowDebugScale = v; });
    bindKnob('knobVelColorScale', 'valVelColorScale', v => { cfg.velColorScale = v; });
    bindKnob('knobPressureRedAt', 'valPressureRedAt', v => { cfg.pressureRedAt = v; });
    bindKnob('knobFoamVelScale', 'valFoamVelScale', v => { cfg.foamVelScale = v; });
    bindKnob('knobNbMassRef', 'valNbMassRef', v => { cfg.nbMassRef = v; });
    bindKnob('knobNbFoamThresh', 'valNbFoamThresh', v => { cfg.nbFoamThresh = v; });
    bindKnob('knobNbVelWhite', 'valNbVelWhite', v => { cfg.nbVelWhite = v; });
    bindKnob('knobDisplayLerp', 'valDisplayLerp', v => { cfg.displayLerp = v; });
    bindKnob('knobArrowStep', 'valArrowStep', v => { cfg.arrowStep = v | 0; }, v => String(v | 0));
    bindKnob('knobGridStep', 'valGridStep', v => { cfg.gridStep = v | 0; }, v => String(v | 0));

    // Sync inicial minFlow desde slider
    {
        const el = document.getElementById('knobMinFlow');
        cfg.minFlow = parseFloat(el.value);
        document.getElementById('valMinFlow').textContent = cfg.minFlow.toFixed(4);
    }

    document.getElementById('btnWater').onclick = (e) => setTool(WATER, e.target);
    document.getElementById('btnSolid').onclick = (e) => setTool(SOLID, e.target);
    document.getElementById('btnErase').onclick = (e) => setTool(AIR, e.target);
    document.getElementById('btnClear').onclick = () => {
        initGrid();
        chunkHasWater.fill(0);
        chunkQuiet.fill(0);
        chunkActiveScratch.fill(0);
        buildProcessChunkList();
        markRenderFullDirty();
    };
    document.getElementById('btnPreset').onclick = () => loadUTubePreset();

    window.addEventListener('resize', () => { displayW = 0; resizeDebugCanvas(); });
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => { displayW = 0; resizeDebugCanvas(); }).observe(canvasStack);
    }

    simCanvasCpu.style.imageRendering = 'pixelated';
    simCanvasGpu.style.imageRendering = 'pixelated';
}
