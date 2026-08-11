import {
  CIRCLE_R, CIRCLE_R_SMALL, SCALE,
  DEBRIS_FULL_POOL, DEBRIS_SMALL_POOL,
  CAT_DEBRIS_FULL, CAT_DEBRIS_SMALL,
  MASK_DEBRIS_FULL, MASK_DEBRIS_SMALL,
  PARK_X, PARK_Y, LASER_SPLIT_IMPULSE
} from './config.js';
import { toScreenX, toScreenY, bodyKey } from './coords.js';

/**
 * Dynamic debris pools (FULL + SMALL).
 * Never Disable/Enable — same Phaser Box2D bug as static pool
 * (SetTransform while disabled does not stick / proxies wrong).
 * Park = SetTransform far + gravityScale 0. Always new b2Vec2.
 */
export function createDebrisSystem(box2d, worldId, scene) {
  const {
    CreateCircle, DYNAMIC, b2Vec2, b2MakeRot,
    b2Body_SetTransform, b2Body_SetUserData,
    b2Body_GetPosition, b2Body_SetAwake, b2Body_SetLinearVelocity,
    b2Body_ApplyLinearImpulseToCenter, b2Body_GetLinearVelocity,
    b2Body_SetBullet, b2Body_SetGravityScale,
    b2Shape_EnableContactEvents, pxm
  } = box2d;

  const rot0 = b2MakeRot(0);
  const fullFree = [];
  const smallFree = [];
  const active = new Map();
  let parkSlot = 0;

  function nextParkPos() {
    const i = parkSlot++;
    return new b2Vec2(PARK_X - i * 5, PARK_Y);
  }

  function bakeTextures() {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    const dFull = CIRCLE_R * 2;
    g.fillStyle(0xc4a574, 1);
    g.fillCircle(CIRCLE_R, CIRCLE_R, CIRCLE_R);
    g.generateTexture('debrisFull', dFull, dFull);
    g.clear();
    const rS = CIRCLE_R_SMALL;
    const dS = rS * 2;
    g.fillStyle(0xe8c99a, 1);
    g.fillCircle(rS, rS, rS);
    g.generateTexture('debrisSmall', dS, dS);
    g.destroy();
  }

  function makePool(count, radiusPx, size) {
    const free = size === 'full' ? fullFree : smallFree;
    const cat = size === 'full' ? CAT_DEBRIS_FULL : CAT_DEBRIS_SMALL;
    const mask = size === 'full' ? MASK_DEBRIS_FULL : MASK_DEBRIS_SMALL;
    for (let i = 0; i < count; i++) {
      const circle = CreateCircle({
        worldId,
        type: DYNAMIC,
        position: nextParkPos(),
        radius: pxm(radiusPx),
        density: 8,
        friction: 0.85,
        restitution: 0.05,
        categoryBits: cat,
        maskBits: mask,
        color: size === 'full' ? 0xc4a574 : 0xe8c99a
      });
      b2Shape_EnableContactEvents(circle.shapeId, false);
      b2Body_SetUserData(circle.bodyId, null);
      b2Body_SetBullet(circle.bodyId, true);
      b2Body_SetGravityScale(circle.bodyId, 0);
      b2Body_SetLinearVelocity(circle.bodyId, new b2Vec2(0, 0));
      b2Body_SetAwake(circle.bodyId, false);
      free.push({ bodyId: circle.bodyId, shapeId: circle.shapeId, size });
    }
  }

  bakeTextures();
  makePool(DEBRIS_FULL_POOL, CIRCLE_R, 'full');
  makePool(DEBRIS_SMALL_POOL, CIRCLE_R_SMALL, 'small');

  const fullBlitter = scene.add.blitter(0, 0, 'debrisFull').setDepth(2);
  const smallBlitter = scene.add.blitter(0, 0, 'debrisSmall').setDepth(2);

  function take(size) {
    const free = size === 'full' ? fullFree : smallFree;
    return free.pop() || null;
  }

  function spawn(size, sx, sy, vx = 0, vy = 0) {
    const slot = take(size);
    if (!slot) return null;
    const { bodyId, shapeId } = slot;
    const r = size === 'full' ? CIRCLE_R : CIRCLE_R_SMALL;

    b2Body_SetGravityScale(bodyId, 1);
    b2Body_SetTransform(bodyId, new b2Vec2(sx / SCALE, -sy / SCALE), rot0);
    b2Body_SetLinearVelocity(bodyId, new b2Vec2(vx, vy));
    b2Shape_EnableContactEvents(shapeId, size === 'small');
    b2Body_SetAwake(bodyId, true);

    const data = { kind: 'debris', size, bodyId, shapeId };
    b2Body_SetUserData(bodyId, data);

    const blitter = size === 'full' ? fullBlitter : smallBlitter;
    const bob = blitter.create(sx - r, sy - r);
    const rec = { bodyId, shapeId, size, bob, r };
    active.set(bodyKey(bodyId), rec);
    return rec;
  }

  function despawn(bodyId) {
    const k = bodyKey(bodyId);
    const rec = active.get(k);
    if (!rec) return false;
    active.delete(k);
    if (rec.bob) {
      rec.bob.destroy();
      rec.bob = null;
    }
    b2Body_SetUserData(bodyId, null);
    b2Body_SetLinearVelocity(bodyId, new b2Vec2(0, 0));
    b2Shape_EnableContactEvents(rec.shapeId, false);
    b2Body_SetGravityScale(bodyId, 0);
    b2Body_SetTransform(bodyId, nextParkPos(), rot0);
    b2Body_SetAwake(bodyId, false);
    const free = rec.size === 'full' ? fullFree : smallFree;
    free.push({ bodyId: rec.bodyId, shapeId: rec.shapeId, size: rec.size });
    return true;
  }

  function despawnByUserData(userData) {
    if (!userData || userData.kind !== 'debris') return false;
    return despawn(userData.bodyId);
  }

  function splitFull(bodyId, laserDirX, laserDirY) {
    const k = bodyKey(bodyId);
    const rec = active.get(k);
    if (!rec || rec.size !== 'full') return false;
    const p = b2Body_GetPosition(bodyId);
    const vel = b2Body_GetLinearVelocity(bodyId);
    const sx = toScreenX(p.x), sy = toScreenY(p.y);
    const vx0 = vel.x, vy0 = vel.y;
    despawn(bodyId);

    const len = Math.hypot(laserDirX, laserDirY) || 1;
    const nx = laserDirX / len, ny = laserDirY / len;
    const px = -ny, py = nx;
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      const ox = Math.cos(ang) * (CIRCLE_R_SMALL + 2);
      const oy = Math.sin(ang) * (CIRCLE_R_SMALL + 2);
      const child = spawn('small', sx + ox, sy + oy, vx0 * 0.5, vy0 * 0.5);
      if (!child) continue;
      const impulse = new b2Vec2(
        (nx * 0.6 + Math.cos(ang) * px + Math.sin(ang) * nx) * LASER_SPLIT_IMPULSE * 0.15,
        (ny * 0.6 + Math.cos(ang) * py + Math.sin(ang) * ny) * LASER_SPLIT_IMPULSE * 0.15
      );
      b2Body_ApplyLinearImpulseToCenter(child.bodyId, impulse, true);
    }
    return true;
  }

  function syncSprites() {
    for (const rec of active.values()) {
      const p = b2Body_GetPosition(rec.bodyId);
      const sx = toScreenX(p.x), sy = toScreenY(p.y);
      if (rec.bob) {
        rec.bob.x = sx - rec.r;
        rec.bob.y = sy - rec.r;
      }
    }
  }

  function drawColliders(gfx) {
    for (const rec of active.values()) {
      const p = b2Body_GetPosition(rec.bodyId);
      const sx = toScreenX(p.x), sy = toScreenY(p.y);
      gfx.lineStyle(1, rec.size === 'full' ? 0xffaa44 : 0xffee88, 0.95);
      gfx.strokeCircle(sx, sy, rec.r);
    }
  }

  function get(bodyId) {
    return active.get(bodyKey(bodyId)) || null;
  }

  function forEachActive(fn) {
    for (const rec of active.values()) {
      const p = b2Body_GetPosition(rec.bodyId);
      fn({
        kind: 'debris',
        size: rec.size,
        bodyId: rec.bodyId,
        x: toScreenX(p.x),
        y: toScreenY(p.y),
        r: rec.r
      });
    }
  }

  return {
    spawn,
    despawn,
    despawnByUserData,
    splitFull,
    syncSprites,
    drawColliders,
    forEachActive,
    get,
    get activeCount() { return active.size; },
    get fullFree() { return fullFree.length; },
    get smallFree() { return smallFree.length; }
  };
}
