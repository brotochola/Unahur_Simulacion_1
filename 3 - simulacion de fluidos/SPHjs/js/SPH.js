const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * A compact, fixed-step SPH-style solver.
 *
 * Particle state is stored in typed, structure-of-arrays buffers. Neighbor
 * queries use a linked-list spatial hash whose cell size matches the smoothing
 * radius. Every pair is visited once across the surrounding 3x3 cells.
 */
export default class SPH {
  constructor({
    width = 1,
    height = 1,
    maxParticles = 6000,
    smoothingRadius = 32,
    boundaryPadding = 18,
  } = {}) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.maxParticles = Math.max(128, maxParticles | 0);
    this.count = 0;

    this.smoothingRadius = smoothingRadius;
    this.smoothingRadiusSquared = smoothingRadius * smoothingRadius;
    this.inverseSmoothingRadius = 1 / smoothingRadius;

    // Double-density relaxation parameters. Negative pressure is deliberately
    // capped: it supplies cohesion without allowing isolated pairs to implode.
    this.restDensity = 5.2;
    this.stiffness = 850;
    this.nearStiffness = 1100;
    this.minimumPressure = -1.3;

    this.gravityStrength = 920;
    this.motionGravityStrength = 1800;
    this.gravityResponse = 18;
    this.gravityX = 0;
    this.gravityY = this.gravityStrength;
    this.targetGravityX = 0;
    this.targetGravityY = this.gravityStrength;
    this.velocityLimit = 800;
    this.boundaryPadding = Math.max(1, boundaryPadding);

    this.x = new Float32Array(this.maxParticles);
    this.y = new Float32Array(this.maxParticles);
    this.previousX = new Float32Array(this.maxParticles);
    this.previousY = new Float32Array(this.maxParticles);
    this.vx = new Float32Array(this.maxParticles);
    this.vy = new Float32Array(this.maxParticles);
    this.density = new Float32Array(this.maxParticles);
    this.nearDensity = new Float32Array(this.maxParticles);
    this.pressure = new Float32Array(this.maxParticles);
    this.nearPressure = new Float32Array(this.maxParticles);
    this.correctionX = new Float32Array(this.maxParticles);
    this.correctionY = new Float32Array(this.maxParticles);
    this.nextParticle = new Int32Array(this.maxParticles);
    this.collisionFlags = new Uint8Array(this.maxParticles);

    this.repulsor = {
      active: false,
      x: 0,
      y: 0,
      radius: 88,
      strength: 6500,
      pulse: 0,
    };

    this.emissionIndex = 0;
    this._allocateGrid();
  }

  get numParticles() {
    return this.count;
  }

  get CanvasWidth() {
    return this.width;
  }

  get CanvasHeight() {
    return this.height;
  }

  _allocateGrid() {
    this.gridColumns = Math.max(1, Math.ceil(this.width / this.smoothingRadius));
    this.gridRows = Math.max(1, Math.ceil(this.height / this.smoothingRadius));
    this.gridHeads = new Int32Array(this.gridColumns * this.gridRows);
    this.gridHeads.fill(-1);
  }

  resize(width, height) {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    if (nextWidth === this.width && nextHeight === this.height) {
      return;
    }

    const oldAspect = this.width / this.height;
    const nextAspect = nextWidth / nextHeight;
    const isOrientationChange = Math.abs(Math.log(nextAspect / oldAspect)) > 0.45;

    if (isOrientationChange && this.count > 0) {
      const scaleX = nextWidth / this.width;
      const scaleY = nextHeight / this.height;
      for (let i = 0; i < this.count; i += 1) {
        this.x[i] *= scaleX;
        this.y[i] *= scaleY;
        this.previousX[i] *= scaleX;
        this.previousY[i] *= scaleY;
      }
    }

    this.width = nextWidth;
    this.height = nextHeight;
    this._allocateGrid();
    this._constrainPositions();
  }

  clear() {
    this.count = 0;
    this.emissionIndex = 0;
    this.repulsor.active = false;
    this.repulsor.pulse = 0;
  }

  setGravityDirection(x, y) {
    const magnitude = Math.hypot(x, y);
    if (!Number.isFinite(magnitude)) {
      return;
    }

    const scale = magnitude > 1 ? 1 / magnitude : 1;
    this.targetGravityX = x * scale * this.motionGravityStrength;
    this.targetGravityY = y * scale * this.motionGravityStrength;
  }

  resetGravity() {
    this.targetGravityX = 0;
    this.targetGravityY = this.gravityStrength;
  }

  setBoundaryPadding(padding) {
    if (!Number.isFinite(padding)) {
      return;
    }
    this.boundaryPadding = clamp(
      padding,
      1,
      Math.max(1, Math.min(this.width, this.height) * 0.5),
    );
    this._constrainPositions();
  }

  setRepulsor(x, y, active = true) {
    this.repulsor.x = x;
    this.repulsor.y = y;
    this.repulsor.active = active;
  }

  push(x, y, radius = 88, strength = 900) {
    this.repulsor.x = x;
    this.repulsor.y = y;
    this.repulsor.radius = radius;
    this.repulsor.pulse = 0.7;
    const radiusSquared = radius * radius;

    for (let i = 0; i < this.count; i += 1) {
      let dx = this.x[i] - x;
      let dy = this.y[i] - y;
      let distanceSquared = dx * dx + dy * dy;

      if (distanceSquared >= radiusSquared) {
        continue;
      }
      if (distanceSquared < 0.001) {
        const angle = ((i * 0.754877666) % 1) * TAU;
        dx = Math.cos(angle) * 0.01;
        dy = Math.sin(angle) * 0.01;
        distanceSquared = 0.0001;
      }

      const distance = Math.sqrt(distanceSquared);
      const falloff = 1 - distance / radius;
      const normalX = dx / distance;
      const normalY = dy / distance;
      const impulse = strength * falloff * falloff;
      const clearedRadius = radius * 0.7;
      const displacement = Math.max(
        8 * falloff * falloff,
        (clearedRadius - distance) * 0.82,
      );
      this.vx[i] += normalX * impulse;
      this.vy[i] += normalY * impulse;
      this.x[i] += normalX * displacement;
      this.y[i] += normalY * displacement;
    }

    this._constrainPositions();
  }

  addParticle(x, y, vx = 0, vy = 0) {
    if (this.count >= this.maxParticles) {
      return false;
    }

    const i = this.count;
    const padding = this.boundaryPadding;
    this.x[i] = clamp(x, padding, Math.max(padding, this.width - padding));
    this.y[i] = clamp(y, padding, Math.max(padding, this.height - padding));
    this.previousX[i] = this.x[i];
    this.previousY[i] = this.y[i];
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.count += 1;
    return true;
  }

  emit(x, y, amount = 1, vx = 0, vy = 70) {
    let emitted = 0;
    const batch = this.emissionIndex++;
    const hasCenter = (amount & 1) === 1;
    const ringCount = amount - (hasCenter ? 1 : 0);
    const phase = batch * 2.3999632297;
    const radius = 11 + (batch % 3) * 2;

    for (let n = 0; n < amount && this.count < this.maxParticles; n += 1) {
      let offsetX = 0;
      let offsetY = 0;

      if (!hasCenter || n > 0) {
        const ringIndex = hasCenter ? n - 1 : n;
        const angle = phase + ringIndex * TAU / ringCount;
        offsetX = Math.cos(angle) * radius;
        offsetY = Math.sin(angle) * radius;
      }

      if (this.addParticle(
        x + offsetX,
        y + offsetY,
        vx + offsetX * 0.25,
        vy,
      )) {
        emitted += 1;
      }
    }

    return emitted;
  }

  seedPool(requestedCount = 420) {
    this.clear();

    const spacing = 10.5;
    const poolWidth = Math.min(this.width * 0.68, 520);
    const columns = Math.max(2, Math.floor(poolWidth / spacing));
    const rows = Math.max(1, Math.floor(Math.min(this.height * 0.52, 520) / spacing));
    const count = Math.min(requestedCount, columns * rows, this.maxParticles);
    const actualWidth = (columns - 1) * spacing;
    const startX = (this.width - actualWidth) * 0.5;
    const bottom = this.height - Math.max(18, this.height * 0.035);

    for (let i = 0; i < count; i += 1) {
      const row = Math.floor(i / columns);
      const column = i % columns;
      const offset = (row & 1) * spacing * 0.5;
      this.addParticle(
        startX + column * spacing + offset,
        bottom - row * spacing,
      );
    }

    return this.count;
  }

  step(dt) {
    if (this.count === 0) {
      return;
    }

    const safeDt = clamp(dt, 1 / 240, 1 / 30);
    this._integratePrediction(safeDt);
    this._buildGrid();
    this._computeDensities();
    this._relaxPositions(safeDt);
    this._constrainPositions();
    this._updateVelocities(safeDt);
  }

  _integratePrediction(dt) {
    const gravityBlend = 1 - Math.exp(-dt * this.gravityResponse);
    this.gravityX += (this.targetGravityX - this.gravityX) * gravityBlend;
    this.gravityY += (this.targetGravityY - this.gravityY) * gravityBlend;

    const damping = Math.pow(0.98, dt * 60);
    const repulsor = this.repulsor;
    const radiusSquared = repulsor.radius * repulsor.radius;
    const isRepulsing = repulsor.active || repulsor.pulse > 0;
    repulsor.pulse = Math.max(0, repulsor.pulse - dt);

    for (let i = 0; i < this.count; i += 1) {
      let velocityX = (this.vx[i] + this.gravityX * dt) * damping;
      let velocityY = (this.vy[i] + this.gravityY * dt) * damping;

      if (isRepulsing) {
        const dx = this.x[i] - repulsor.x;
        const dy = this.y[i] - repulsor.y;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared < radiusSquared) {
          const distance = Math.sqrt(Math.max(distanceSquared, 0.01));
          const falloff = 1 - distance / repulsor.radius;
          const impulse = repulsor.strength * falloff * falloff * dt;
          velocityX += (dx / distance) * impulse;
          velocityY += (dy / distance) * impulse;
        }
      }

      this.previousX[i] = this.x[i];
      this.previousY[i] = this.y[i];
      this.vx[i] = velocityX;
      this.vy[i] = velocityY;
      this.x[i] += velocityX * dt;
      this.y[i] += velocityY * dt;
    }
  }

  _buildGrid() {
    this.gridHeads.fill(-1);
    const inverseCellSize = this.inverseSmoothingRadius;
    const maxColumn = this.gridColumns - 1;
    const maxRow = this.gridRows - 1;

    for (let i = 0; i < this.count; i += 1) {
      const column = clamp(Math.floor(this.x[i] * inverseCellSize), 0, maxColumn);
      const row = clamp(Math.floor(this.y[i] * inverseCellSize), 0, maxRow);
      const cell = row * this.gridColumns + column;
      this.nextParticle[i] = this.gridHeads[cell];
      this.gridHeads[cell] = i;
    }
  }

  _computeDensities() {
    const count = this.count;
    const columns = this.gridColumns;
    const rows = this.gridRows;
    const inverseRadius = this.inverseSmoothingRadius;
    const radiusSquared = this.smoothingRadiusSquared;

    this.density.fill(1, 0, count);
    this.nearDensity.fill(1, 0, count);

    for (let i = 0; i < count; i += 1) {
      const centerColumn = clamp(Math.floor(this.x[i] * inverseRadius), 0, columns - 1);
      const centerRow = clamp(Math.floor(this.y[i] * inverseRadius), 0, rows - 1);
      const minColumn = Math.max(0, centerColumn - 1);
      const maxColumn = Math.min(columns - 1, centerColumn + 1);
      const minRow = Math.max(0, centerRow - 1);
      const maxRow = Math.min(rows - 1, centerRow + 1);

      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          let j = this.gridHeads[row * columns + column];

          while (j !== -1) {
            if (j > i) {
              const dx = this.x[i] - this.x[j];
              const dy = this.y[i] - this.y[j];
              const distanceSquared = dx * dx + dy * dy;

              if (distanceSquared < radiusSquared) {
                const distance = Math.sqrt(distanceSquared);
                const weight = 1 - distance * inverseRadius;
                const densityWeight = weight * weight;
                const nearWeight = densityWeight * weight;
                this.density[i] += densityWeight;
                this.density[j] += densityWeight;
                this.nearDensity[i] += nearWeight;
                this.nearDensity[j] += nearWeight;
              }
            }
            j = this.nextParticle[j];
          }
        }
      }
    }

    for (let i = 0; i < count; i += 1) {
      const densityError = Math.max(
        this.minimumPressure,
        this.density[i] - this.restDensity,
      );
      this.pressure[i] = densityError * this.stiffness;
      this.nearPressure[i] = this.nearDensity[i] * this.nearStiffness;
    }
  }

  _relaxPositions(dt) {
    const count = this.count;
    const columns = this.gridColumns;
    const rows = this.gridRows;
    const inverseRadius = this.inverseSmoothingRadius;
    const radiusSquared = this.smoothingRadiusSquared;
    const dtSquared = dt * dt;
    const maximumPairDisplacement = this.smoothingRadius * 0.06;
    const maximumTotalDisplacement = this.smoothingRadius * 0.12;
    const correctionX = this.correctionX;
    const correctionY = this.correctionY;

    correctionX.fill(0, 0, count);
    correctionY.fill(0, 0, count);

    for (let i = 0; i < count; i += 1) {
      const centerColumn = clamp(Math.floor(this.x[i] * inverseRadius), 0, columns - 1);
      const centerRow = clamp(Math.floor(this.y[i] * inverseRadius), 0, rows - 1);
      const minColumn = Math.max(0, centerColumn - 1);
      const maxColumn = Math.min(columns - 1, centerColumn + 1);
      const minRow = Math.max(0, centerRow - 1);
      const maxRow = Math.min(rows - 1, centerRow + 1);

      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          let j = this.gridHeads[row * columns + column];

          while (j !== -1) {
            if (j > i) {
              let dx = this.x[i] - this.x[j];
              let dy = this.y[i] - this.y[j];
              let distanceSquared = dx * dx + dy * dy;

              if (distanceSquared < radiusSquared) {
                if (distanceSquared < 0.0001) {
                  const angle = ((i * 0.754877666 + j * 0.569840296) % 1) * TAU;
                  dx = Math.cos(angle) * 0.01;
                  dy = Math.sin(angle) * 0.01;
                  distanceSquared = 0.0001;
                }

                const distance = Math.sqrt(distanceSquared);
                const normalX = dx / distance;
                const normalY = dy / distance;
                const weight = 1 - distance * inverseRadius;
                const pressure = (this.pressure[i] + this.pressure[j]) * 0.5;
                const nearPressure = (this.nearPressure[i] + this.nearPressure[j]) * 0.5;
                let displacement = dtSquared * (
                  pressure * weight + nearPressure * weight * weight
                ) * 0.5;

                displacement = clamp(
                  displacement,
                  -maximumPairDisplacement * 0.2,
                  maximumPairDisplacement,
                );

                const moveX = normalX * displacement;
                const moveY = normalY * displacement;
                correctionX[i] += moveX;
                correctionY[i] += moveY;
                correctionX[j] -= moveX;
                correctionY[j] -= moveY;
              }
            }
            j = this.nextParticle[j];
          }
        }
      }
    }

    // Pair corrections used to be applied immediately. In a dense pile, a
    // particle could receive dozens of individually valid corrections and be
    // launched across the viewport. Accumulating against one position state
    // makes the solve order-independent; the total cap prevents pressure from
    // becoming an unbounded velocity impulse on slower mobile frames.
    const maximumTotalSquared = maximumTotalDisplacement ** 2;
    for (let i = 0; i < count; i += 1) {
      let moveX = correctionX[i];
      let moveY = correctionY[i];
      const lengthSquared = moveX * moveX + moveY * moveY;

      if (lengthSquared > maximumTotalSquared) {
        const scale = maximumTotalDisplacement / Math.sqrt(lengthSquared);
        moveX *= scale;
        moveY *= scale;
      }

      this.x[i] += moveX;
      this.y[i] += moveY;
    }
  }

  _constrainPositions() {
    const min = this.boundaryPadding;
    const maxX = Math.max(min, this.width - min);
    const maxY = Math.max(min, this.height - min);

    for (let i = 0; i < this.count; i += 1) {
      let flags = 0;

      if (this.x[i] < min) {
        this.x[i] = min;
        flags |= 1;
      } else if (this.x[i] > maxX) {
        this.x[i] = maxX;
        flags |= 2;
      }

      if (this.y[i] < min) {
        this.y[i] = min;
        flags |= 4;
      } else if (this.y[i] > maxY) {
        this.y[i] = maxY;
        flags |= 8;
      }

      this.collisionFlags[i] = flags;
    }
  }

  _updateVelocities(dt) {
    const inverseDt = 1 / dt;
    const limit = this.velocityLimit;

    for (let i = 0; i < this.count; i += 1) {
      let velocityX = (this.x[i] - this.previousX[i]) * inverseDt;
      let velocityY = (this.y[i] - this.previousY[i]) * inverseDt;
      const speedSquared = velocityX * velocityX + velocityY * velocityY;
      const limitSquared = limit * limit;

      if (speedSquared > limitSquared) {
        const scale = limit / Math.sqrt(speedSquared);
        velocityX *= scale;
        velocityY *= scale;
      }
      const flags = this.collisionFlags[i];

      if ((flags & 1 && velocityX < 0) || (flags & 2 && velocityX > 0)) {
        velocityX *= -0.18;
      }
      if ((flags & 4 && velocityY < 0) || (flags & 8 && velocityY > 0)) {
        velocityY *= -0.12;
      }

      this.vx[i] = velocityX;
      this.vy[i] = velocityY;
    }
  }

}
