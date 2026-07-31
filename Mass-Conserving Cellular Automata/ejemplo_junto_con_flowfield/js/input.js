/**
 * input.js — Mouse, brush y herramientas de pintura.
 */
'use strict';

function updateMousePos(e) {
    const rect = debugCanvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    runtime.mouseX = Math.floor(clientX * (GRID_SIZE / rect.width));
    runtime.mouseY = Math.floor(clientY * (GRID_SIZE / rect.height));
}

function handleMouseInput() {
    if (!runtime.isMouseDown) return;
    const mouseX = runtime.mouseX;
    const mouseY = runtime.mouseY;
    if (mouseX < 0 || mouseX >= GRID_SIZE || mouseY < 0 || mouseY >= GRID_SIZE) return;

    const r = cfg.brushRadius;
    const r2 = r * r;
    const tool = runtime.currentTool;
    const paintAmount = cfg.brushAmount;

    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const px = mouseX + dx;
            const py = mouseY + dy;
            if (px <= 0 || px >= GRID_SIZE - 1 || py <= 0 || py >= GRID_SIZE - 1) continue;

            const idx = px + py * GRID_SIZE;
            if (tool === WATER) {
                if (typeGrid[idx] === SOLID) continue;
                typeGrid[idx] = WATER;
                massRead[idx] += paintAmount;
                markChunkAtCell(px, py, massRead[idx]);
            } else if (tool === SOLID) {
                typeGrid[idx] = SOLID;
                massRead[idx] = 0;
                flowX[idx] = 0;
                flowY[idx] = 0;
            } else if (tool === AIR) {
                typeGrid[idx] = AIR;
                massRead[idx] = 0;
                flowX[idx] = 0;
                flowY[idx] = 0;
            }
        }
    }
    // SOLID/AIR no despiertan chunks; sin dirty full el upload salta celdas dormidas
    if (tool === SOLID || tool === AIR) markRenderFullDirty();
    rebuildChunkFlagsFromWater();
    buildProcessChunkList();
}

function setTool(tool, btn) {
    runtime.currentTool = tool;
    document.querySelectorAll('.btn-grid-2 button').forEach(b => {
        if (!b.classList.contains('action-btn')) b.classList.remove('active');
    });
    btn.classList.add('active');
}

function bindInputEvents() {
    debugCanvas.onmousedown = (e) => {
        runtime.isMouseDown = true;
        updateMousePos(e);
    };
    debugCanvas.onmousemove = (e) => updateMousePos(e);
    window.onmouseup = () => { runtime.isMouseDown = false; };
    debugCanvas.onmouseleave = () => {
        runtime.mouseX = -1;
        runtime.mouseY = -1;
    };
}
