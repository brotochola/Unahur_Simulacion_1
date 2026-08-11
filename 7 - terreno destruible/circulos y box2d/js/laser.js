import { LASER_HIT_INTERVAL_MS, LASER_DETACH_IMPULSE, SCALE } from './config.js';

/**
 * Hold-E laser. Uses manual ray-vs-circle tests against live collider centers
 * (same data as debug outlines). Box2D CastRay was skipping many circles.
 */
export function createLaser(box2d, scene, opts) {
  const {
    b2Vec2,
    b2Body_GetPosition,
    b2Body_ApplyLinearImpulseToCenter,
    b2Body_SetAwake
  } = box2d;

  const gfx = scene.add.graphics().setDepth(5);
  let lastHitAt = 0;

  /**
   * Closest hit of segment (ox,oy)->(tx,ty) against circles {x,y,r,...}.
   * If origin is inside a circle, counts as hit at t=0.
   */
  function raycastCircles(ox, oy, tx, ty, circles) {
    const dx = tx - ox;
    const dy = ty - oy;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-8) return null;

    let bestT = 1;
    let best = null;

    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      const fx = ox - c.x;
      const fy = oy - c.y;
      const r2 = c.r * c.r;
      const b = 2 * (fx * dx + fy * dy);
      const cc = fx * fx + fy * fy - r2;
      const disc = b * b - 4 * len2 * cc;
      if (disc < 0) continue;
      const s = Math.sqrt(disc);
      const t1 = (-b - s) / (2 * len2);
      const t2 = (-b + s) / (2 * len2);

      // Origin inside this circle → hit immediately (don't skip through it)
      if (t1 < 0 && t2 > 0 && 0 < bestT) {
        bestT = 0;
        best = c;
        continue;
      }
      if (t1 >= 0 && t1 < bestT) {
        bestT = t1;
        best = c;
      }
    }

    if (!best) return null;
    return {
      t: bestT,
      target: best,
      x: ox + dx * bestT,
      y: oy + dy * bestT
    };
  }

  function tick(time, playerBodyId, mouseSx, mouseSy, handlers) {
    const held = scene.keys.E && scene.keys.E.isDown;
    gfx.clear();
    if (!held) return;

    const pos = b2Body_GetPosition(playerBodyId);
    const ox = pos.x * SCALE;
    const oy = -pos.y * SCALE;

    const circles = handlers.collectTargets ? handlers.collectTargets() : [];
    const hit = raycastCircles(ox, oy, mouseSx, mouseSy, circles);

    const endSx = hit ? hit.x : mouseSx;
    const endSy = hit ? hit.y : mouseSy;

    gfx.lineStyle(2, 0xff3355, 0.95);
    gfx.lineBetween(ox, oy, endSx, endSy);
    if (hit) {
      gfx.fillStyle(0xff3355, 1);
      gfx.fillCircle(endSx, endSy, 4);
    }

    if (!hit || time - lastHitAt < LASER_HIT_INTERVAL_MS) return;
    lastHitAt = time;

    const t = hit.target;
    if (t.kind === 'terrain') {
      handlers.onHitTerrain(t.key);
      return;
    }
    if (t.kind === 'debris') {
      if (t.size === 'full') {
        const dirX = (mouseSx - ox) / SCALE;
        const dirY = -(mouseSy - oy) / SCALE;
        handlers.onHitDebrisFull(t.bodyId, dirX, dirY);
      } else {
        handlers.onHitDebrisSmall(t.bodyId);
      }
    }
  }

  function nudgeDetach(bodyId, fromSx, fromSy, toSx, toSy) {
    const dx = (toSx - fromSx) / SCALE;
    const dy = -(toSy - fromSy) / SCALE;
    const len = Math.hypot(dx, dy) || 1;
    b2Body_SetAwake(bodyId, true);
    b2Body_ApplyLinearImpulseToCenter(
      bodyId,
      new b2Vec2((dx / len) * LASER_DETACH_IMPULSE * 0.2, (dy / len) * LASER_DETACH_IMPULSE * 0.2 + 0.4),
      true
    );
  }

  return { tick, nudgeDetach, gfx, raycastCircles };
}
