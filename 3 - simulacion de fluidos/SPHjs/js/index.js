import SPH from "./SPH.js";
import MotionGravity from "./MotionGravity.js";
import { createRenderer } from "./Renderer.js";
import { createWebGPUFluid } from "./WebGPUFluid.js";

const FIXED_TIME_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.05;
const MAX_SUBSTEPS = 3;
const HELP_PARTICLE_THRESHOLD = 32;

const app = document.querySelector("#app");
let canvas = document.querySelector("#fluid-canvas");
const backendLabel = document.querySelector("#backend-label");
const particleCount = document.querySelector("#particle-count");
const fpsCount = document.querySelector("#fps-count");
const interactionHint = document.querySelector("#interaction-hint");
const resetButton = document.querySelector("#reset-button");
const motionButton = document.querySelector("#motion-button");
const waterToolButton = document.querySelector("#water-tool-button");
const touchToolButton = document.querySelector("#touch-tool-button");
const motionPrompt = document.querySelector("#motion-prompt");
const motionEnable = document.querySelector("#motion-enable");
const motionDismiss = document.querySelector("#motion-dismiss");
const motionTitle = document.querySelector("#motion-title");
const motionDescription = motionPrompt.querySelector("p");
const statusMessage = document.querySelector("#status-message");

const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
const memory = Number(navigator.deviceMemory) || 8;
const processorCount = Number(navigator.hardwareConcurrency) || 4;
const constrainedDevice = memory <= 3 || processorCount <= 4;
const maxParticles = constrainedDevice ? 3200 : coarsePointer ? 4600 : 18000;

function preferredParticleDiameter(width, height) {
  if (!coarsePointer) {
    return 40;
  }
  const shortEdge = Math.min(width, height);
  return Math.round(Math.max(28, Math.min(34, shortEdge * 0.076)));
}

function readViewport() {
  const viewport = window.visualViewport;
  return {
    width: Math.max(1, viewport?.width || window.innerWidth),
    height: Math.max(1, viewport?.height || window.innerHeight),
  };
}

const initialViewport = readViewport();
const initialParticleDiameter = preferredParticleDiameter(
  initialViewport.width,
  initialViewport.height,
);
let simulation;
let renderer;
try {
  const gpuFluid = await createWebGPUFluid(canvas, {
    width: initialViewport.width,
    height: initialViewport.height,
    maxParticles,
    boundaryPadding: initialParticleDiameter * 0.5,
    pointDiameter: initialParticleDiameter,
  });
  if (gpuFluid) {
    simulation = gpuFluid;
    renderer = gpuFluid;
  }
} catch (error) {
  // A canvas cannot switch context types after WebGPU claims it. Replace the
  // untouched element before constructing the WebGL2 fallback.
  console.warn("WebGPU initialization failed; using the fallback.", error);
  const replacement = canvas.cloneNode(true);
  canvas.replaceWith(replacement);
  canvas = replacement;
}

if (!simulation) {
  simulation = new SPH({
    width: initialViewport.width,
    height: initialViewport.height,
    maxParticles,
    boundaryPadding: initialParticleDiameter * 0.5,
  });
  try {
    renderer = createRenderer(canvas, maxParticles);
    renderer.setParticleDiameter(initialParticleDiameter);
  } catch (error) {
    backendLabel.textContent = "renderer unavailable";
    statusMessage.textContent = error.message;
    statusMessage.classList.add("is-visible");
    throw error;
  }
}
backendLabel.textContent = renderer.backend;

let renderScale = 1;
let statusTimer = 0;
let resizeFrame = 0;
let lastQualityChange = 0;

function preferredPixelRatio() {
  // The original water texture benefits from a slightly soft, one-CSS-pixel
  // buffer and avoids processing millions of retina pixels twice per frame.
  const cap = 1;
  return Math.min(window.devicePixelRatio || 1, cap) * renderScale;
}

function resize() {
  resizeFrame = 0;
  const viewport = readViewport();
  const particleDiameter = preferredParticleDiameter(
    viewport.width,
    viewport.height,
  );
  document.documentElement.style.setProperty(
    "--app-height",
    `${viewport.height}px`,
  );
  const bounds = canvas.getBoundingClientRect();
  simulation.resize(bounds.width, bounds.height);
  simulation.setBoundaryPadding(particleDiameter * 0.5);
  renderer.setParticleDiameter(particleDiameter);
  renderer.resize(bounds.width, bounds.height, preferredPixelRatio());
}

function scheduleResize() {
  if (!resizeFrame) {
    resizeFrame = requestAnimationFrame(resize);
  }
}

function showStatus(message, duration = 2800) {
  window.clearTimeout(statusTimer);
  statusMessage.textContent = message;
  statusMessage.classList.add("is-visible");
  statusTimer = window.setTimeout(() => {
    statusMessage.classList.remove("is-visible");
  }, duration);
}

function resetFluid() {
  simulation.clear();
  renderer.render(simulation);
  particleCount.textContent = simulation.count.toLocaleString();
}

resize();
resetFluid();

const pageParameters = new URLSearchParams(window.location.search);
const requestedParticles = Number.parseInt(
  pageParameters.get("particles") || "0",
  10,
);
if (requestedParticles > 0 && typeof simulation.seedPool === "function") {
  simulation.seedPool(Math.min(requestedParticles, simulation.maxParticles));
  renderer.render(simulation);
  particleCount.textContent = simulation.count.toLocaleString();
}
const testGravityDirections = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};
const testGravity = testGravityDirections[pageParameters.get("gravity")];
if (testGravity) {
  simulation.setGravityDirection(...testGravity);
}

window.addEventListener("resize", scheduleResize, { passive: true });
window.visualViewport?.addEventListener("resize", scheduleResize, {
  passive: true,
});
window.addEventListener(
  "orientationchange",
  () => {
    window.setTimeout(scheduleResize, 120);
  },
  { passive: true },
);

canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  showStatus("The graphics context paused. Restoring…", 5000);
});
canvas.addEventListener("webglcontextrestored", () => {
  window.location.reload();
});

const activePointers = new Map();
let emissionBudget = 0;
let reachedParticleLimit = false;
let activeTool = "water";
let helpDismissed = false;
const emissionRate = constrainedDevice ? 210 : coarsePointer ? 270 : 360;

function setActiveTool(tool) {
  activeTool = tool === "touch" ? "touch" : "water";
  const waterActive = activeTool === "water";
  waterToolButton.classList.toggle("is-active", waterActive);
  waterToolButton.setAttribute("aria-pressed", String(waterActive));
  touchToolButton.classList.toggle("is-active", !waterActive);
  touchToolButton.setAttribute("aria-pressed", String(!waterActive));
}

waterToolButton.addEventListener("click", () => {
  setActiveTool("water");
  showStatus("Water mode — touch to pour.", 1500);
});

touchToolButton.addEventListener("click", () => {
  setActiveTool("touch");
  showStatus("Touch mode — drag to push water.", 1500);
});

function pointerPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) * simulation.width) / bounds.width,
    y: ((event.clientY - bounds.top) * simulation.height) / bounds.height,
  };
}

function countTouchPointers() {
  let count = 0;
  for (const pointer of activePointers.values()) {
    if (pointer.pointerType === "touch") {
      count += 1;
    }
  }
  return count;
}

function updatePointer(event) {
  const pointer = activePointers.get(event.pointerId);
  if (!pointer) {
    return;
  }

  const position = pointerPosition(event);
  const now = performance.now();
  const elapsed = Math.max(8, now - pointer.updatedAt) / 1000;
  const instantaneousX = (position.x - pointer.x) / elapsed;
  const instantaneousY = (position.y - pointer.y) / elapsed;
  pointer.velocityX += (instantaneousX - pointer.velocityX) * 0.28;
  pointer.velocityY += (instantaneousY - pointer.velocityY) * 0.28;
  pointer.x = position.x;
  pointer.y = position.y;
  pointer.updatedAt = now;
}

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  const position = pointerPosition(event);
  const existingTouches = countTouchPointers();
  const isRepulsor =
    activeTool === "touch" ||
    event.button === 2 ||
    event.button === 1 ||
    event.shiftKey ||
    (event.pointerType === "touch" && existingTouches > 0);

  activePointers.set(event.pointerId, {
    ...position,
    pointerType: event.pointerType,
    mode: isRepulsor ? "repel" : "pour",
    velocityX: 0,
    velocityY: 0,
    updatedAt: performance.now(),
  });
  if (isRepulsor) {
    simulation.push(position.x, position.y);
  } else {
    simulation.emit(position.x, position.y, 190, 0, 0);
  }
  canvas.setPointerCapture?.(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (activePointers.has(event.pointerId)) {
    event.preventDefault();
    updatePointer(event);
  }
});

function releasePointer(event) {
  if (!activePointers.has(event.pointerId)) {
    return;
  }
  event.preventDefault();
  activePointers.delete(event.pointerId);
  if (canvas.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("lostpointercapture", (event) => {
  activePointers.delete(event.pointerId);
});
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

function updateInteractions(dt) {
  let pouringPointer = null;
  let repellingPointer = null;

  for (const pointer of activePointers.values()) {
    if (!pouringPointer && pointer.mode === "pour") {
      pouringPointer = pointer;
    }
    if (!repellingPointer && pointer.mode === "repel") {
      repellingPointer = pointer;
    }
  }

  if (pouringPointer && simulation.count < simulation.maxParticles) {
    emissionBudget += emissionRate * dt;
    const amount = Math.min(9, Math.floor(emissionBudget));
    if (amount > 0) {
      emissionBudget -= amount;
      simulation.emit(
        pouringPointer.x,
        pouringPointer.y,
        amount,
        pouringPointer.velocityX * 0.12,
        pouringPointer.velocityY * 0.12 + 55,
      );
    }
  } else {
    emissionBudget = 0;
  }

  if (simulation.count >= simulation.maxParticles && !reachedParticleLimit) {
    reachedParticleLimit = true;
    showStatus(
      `Particle limit reached (${simulation.maxParticles.toLocaleString()}) to protect mobile performance.`,
      4200,
    );
  } else if (simulation.count < simulation.maxParticles) {
    reachedParticleLimit = false;
  }

  if (repellingPointer) {
    simulation.setRepulsor(repellingPointer.x, repellingPointer.y, true);
  } else {
    simulation.repulsor.active = false;
  }
}

function setMotionControl(label, { active = false, busy = false } = {}) {
  motionButton.setAttribute("aria-label", label);
  motionButton.setAttribute("title", label);
  motionButton.setAttribute("aria-pressed", String(active));
  motionButton.classList.toggle("is-active", active);
  motionButton.toggleAttribute("aria-busy", busy);
}

const motion = new MotionGravity({
  onGravity: (x, y) => simulation.setGravityDirection(x, y),
  onState: (state, message) => {
    if (message) {
      showStatus(message, state === "active" ? 1800 : 4200);
    }

    if (state === "active") {
      setMotionControl("Turn off motion gravity", { active: true });
      motionPrompt.hidden = true;
    } else if (state === "disabled") {
      setMotionControl("Turn on motion gravity");
    } else if (state === "denied" || state === "error") {
      setMotionControl("Try motion gravity again");
    }
  },
});

async function enableMotion() {
  motionPrompt.hidden = true;
  setMotionControl("Starting motion gravity", { busy: true });
  const enabled = await motion.enable();
  if (!enabled) {
    setMotionControl("Try motion gravity again");
  }
}

motionDismiss.addEventListener("click", () => {
  motionPrompt.hidden = true;
});

if (motion.mobileDevice && !motion.secureContext) {
  setMotionControl("Motion gravity requires HTTPS");
  motionTitle.textContent = "Motion needs HTTPS";
  motionDescription.textContent =
    "This phone is loading the demo over a plain LAN HTTP address. iOS and Android block IMU access here; open the page from an HTTPS URL to receive the browser permission prompt.";
  motionEnable.textContent = "Close";
  motionButton.addEventListener("click", () => {
    motionPrompt.hidden = false;
  });
  motionEnable.addEventListener("click", () => {
    motionPrompt.hidden = true;
  });
  window.setTimeout(() => {
    motionPrompt.hidden = false;
  }, 650);
} else if (!motion.supported) {
  if (motion.mobileDevice) {
    setMotionControl("Motion gravity unavailable");
    motionTitle.textContent = "Motion unavailable";
    motionDescription.textContent =
      "This browser does not expose device motion sensors. Try the current Safari or Chrome browser.";
    motionEnable.textContent = "Close";
    motionButton.addEventListener("click", () => {
      motionPrompt.hidden = false;
    });
    motionEnable.addEventListener("click", () => {
      motionPrompt.hidden = true;
    });
  } else {
    motionButton.hidden = true;
  }
} else {
  setMotionControl("Turn on motion gravity");
  motionButton.addEventListener("click", () => {
    if (motion.enabled) {
      motion.disable();
      simulation.resetGravity();
    } else {
      enableMotion();
    }
  });
  motionEnable.addEventListener("click", enableMotion);

  if (motion.shouldPrompt) {
    window.setTimeout(() => {
      if (!motion.enabled) {
        motionPrompt.hidden = false;
      }
    }, 650);
  }
}

resetButton.addEventListener("click", () => {
  resetFluid();
  showStatus("Fluid cleared.");
});

let previousTime = performance.now();
let accumulator = 0;
let renderedFrames = 0;
let fpsWindowStart = previousTime;
let measuredFps = 60;
let animationFrame = 0;

function updateQuality(now) {
  if (now - lastQualityChange < 4500) {
    return;
  }

  if (measuredFps < 44 && renderScale > 0.76 && simulation.count > 900) {
    renderScale = 0.75;
    lastQualityChange = now;
    resize();
  } else if (measuredFps > 57 && renderScale < 1 && simulation.count < 2200) {
    renderScale = 1;
    lastQualityChange = now;
    resize();
  }
}

function frame(now) {
  const frameDelta = Math.min(MAX_FRAME_DELTA, (now - previousTime) / 1000);
  previousTime = now;
  accumulator += frameDelta;
  let substeps = 0;

  while (accumulator >= FIXED_TIME_STEP && substeps < MAX_SUBSTEPS) {
    updateInteractions(FIXED_TIME_STEP);
    simulation.step(FIXED_TIME_STEP);
    accumulator -= FIXED_TIME_STEP;
    substeps += 1;
  }

  if (substeps === MAX_SUBSTEPS && accumulator >= FIXED_TIME_STEP) {
    accumulator = 0;
  }

  if (!helpDismissed && simulation.count >= HELP_PARTICLE_THRESHOLD) {
    helpDismissed = true;
    interactionHint.classList.add("is-hidden");
  }

  // High-refresh phones may call rAF at 90–120 Hz. The simulation advances at
  // 60 Hz, so only render frames containing a new physics state.
  if (substeps > 0) {
    if (simulation.count > 0) {
      renderer.render(simulation);
    }
    renderedFrames += 1;
  }

  if (now - fpsWindowStart >= 1000) {
    measuredFps = Math.round((renderedFrames * 1000) / (now - fpsWindowStart));
    fpsCount.textContent = String(measuredFps);
    particleCount.textContent = simulation.count.toLocaleString();
    renderedFrames = 0;
    fpsWindowStart = now;
    updateQuality(now);
  }

  animationFrame = requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  } else if (!animationFrame) {
    previousTime = performance.now();
    accumulator = 0;
    animationFrame = requestAnimationFrame(frame);
  }
});

renderer.render(simulation);
animationFrame = requestAnimationFrame(frame);
