import assert from "node:assert/strict";
import test from "node:test";

import SPH from "../js/SPH.js";

test("neighbors interact across spatial-hash cell boundaries exactly once", () => {
  const simulation = new SPH({
    width: 200,
    height: 200,
    maxParticles: 128,
    smoothingRadius: 32,
  });
  simulation.addParticle(31, 100);
  simulation.addParticle(33, 100);
  simulation._buildGrid();
  simulation._computeDensities();

  const expectedDensity = 1 + (1 - 2 / 32) ** 2;
  assert.ok(Math.abs(simulation.density[0] - expectedDensity) < 1e-5);
  assert.ok(Math.abs(simulation.density[1] - expectedDensity) < 1e-5);
});

test("overlapping particles remain finite", () => {
  const simulation = new SPH({
    width: 200,
    height: 200,
    maxParticles: 128,
  });
  simulation.addParticle(100, 100);
  simulation.addParticle(100, 100);

  for (let frame = 0; frame < 120; frame += 1) {
    simulation.step(1 / 60);
  }

  for (let i = 0; i < simulation.count; i += 1) {
    assert.ok(Number.isFinite(simulation.x[i]));
    assert.ok(Number.isFinite(simulation.y[i]));
    assert.ok(Number.isFinite(simulation.vx[i]));
    assert.ok(Number.isFinite(simulation.vy[i]));
  }
});

test("a quick push creates an immediate particle-free gap", () => {
  const simulation = new SPH({
    width: 400,
    height: 400,
    maxParticles: 256,
  });

  for (let y = 150; y <= 250; y += 10) {
    for (let x = 150; x <= 250; x += 10) {
      simulation.addParticle(x, y);
    }
  }

  simulation.push(200, 200);
  let closestParticle = Infinity;
  for (let i = 0; i < simulation.count; i += 1) {
    closestParticle = Math.min(
      closestParticle,
      Math.hypot(simulation.x[i] - 200, simulation.y[i] - 200),
    );
  }

  assert.ok(closestParticle > 45);

  for (let frame = 0; frame < 18; frame += 1) {
    simulation.step(1 / 60);
  }
  closestParticle = Infinity;
  for (let i = 0; i < simulation.count; i += 1) {
    closestParticle = Math.min(
      closestParticle,
      Math.hypot(simulation.x[i] - 200, simulation.y[i] - 200),
    );
  }
  // The cleared center must remain wider than the 40 px rendered sprite even
  // while the surrounding fluid relaxes back toward it.
  assert.ok(closestParticle > 34);
});

test("the top wall contains the full visible particle", () => {
  const visibleRadius = 15;
  const simulation = new SPH({
    width: 390,
    height: 844,
    maxParticles: 128,
    boundaryPadding: visibleRadius,
  });
  simulation.addParticle(195, 60, 0, -900);
  simulation.setGravityDirection(0, -1);

  for (let frame = 0; frame < 120; frame += 1) {
    simulation.step(1 / 60);
    assert.ok(simulation.y[0] >= visibleRadius);
  }
});

test("motion gravity responds promptly while respecting the speed limit", () => {
  const simulation = new SPH({
    width: 1600,
    height: 900,
    maxParticles: 128,
    boundaryPadding: 20,
  });
  simulation.addParticle(500, 450);
  simulation.setGravityDirection(1, 0);

  for (let frame = 0; frame < 18; frame += 1) {
    simulation.step(1 / 60);
  }

  assert.ok(simulation.vx[0] > 350);
  assert.ok(Math.hypot(simulation.vx[0], simulation.vy[0]) <= simulation.velocityLimit);
});

test("a 1,800-particle portrait pile settles without airborne explosions", () => {
  const simulation = new SPH({
    width: 390,
    height: 844,
    maxParticles: 1900,
    boundaryPadding: 15,
  });

  for (let frame = 0; frame < 720; frame += 1) {
    if (simulation.count < 1800) {
      simulation.emit(195, 90, 4, 0, 55);
    }
    simulation.step(1 / 60);
  }

  let highestParticle = simulation.height;
  let maximumSpeed = 0;
  for (let i = 0; i < simulation.count; i += 1) {
    highestParticle = Math.min(highestParticle, simulation.y[i]);
    maximumSpeed = Math.max(
      maximumSpeed,
      Math.hypot(simulation.vx[i], simulation.vy[i]),
    );
  }

  assert.equal(simulation.count, 1800);
  assert.ok(highestParticle > simulation.height * 0.4);
  assert.ok(maximumSpeed < 250);
});

test("a dense mobile-sized simulation stays inside its bounds", () => {
  const simulation = new SPH({
    width: 390,
    height: 844,
    maxParticles: 1200,
  });

  for (let i = 0; i < 1200; i += 1) {
    const column = i % 50;
    const row = Math.floor(i / 50);
    simulation.addParticle(35 + column * 6.2, 820 - row * 6.2);
  }

  for (let frame = 0; frame < 180; frame += 1) {
    simulation.step(1 / 60);
  }

  for (let i = 0; i < simulation.count; i += 1) {
    assert.ok(simulation.x[i] >= simulation.boundaryPadding);
    assert.ok(simulation.x[i] <= simulation.width - simulation.boundaryPadding);
    assert.ok(simulation.y[i] >= simulation.boundaryPadding);
    assert.ok(simulation.y[i] <= simulation.height - simulation.boundaryPadding);
  }
});
