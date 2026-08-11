import { bodyKey } from './coords.js';

/**
 * After WorldStep, despawn SMALL debris that began contact with the player.
 */
export function createContactProcessor(box2d, worldId, playerBodyId, debris) {
  const {
    b2World_GetContactEvents, b2Shape_GetBody, b2Body_GetUserData
  } = box2d;

  const playerKey = bodyKey(playerBodyId);
  const pending = [];

  function process() {
    const events = b2World_GetContactEvents(worldId);
    pending.length = 0;
    const n = events.beginCount || 0;
    const arr = events.beginEvents;
    if (!arr || n === 0) return;

    for (let i = 0; i < n; i++) {
      const ev = arr[i];
      if (!ev || !ev.shapeIdA || !ev.shapeIdB) continue;
      const bodyA = b2Shape_GetBody(ev.shapeIdA);
      const bodyB = b2Shape_GetBody(ev.shapeIdB);
      const keyA = bodyKey(bodyA);
      const keyB = bodyKey(bodyB);
      let other = null;
      if (keyA === playerKey) other = bodyB;
      else if (keyB === playerKey) other = bodyA;
      else continue;

      const data = b2Body_GetUserData(other);
      if (data && data.kind === 'debris' && data.size === 'small') {
        pending.push(other);
      }
    }

    for (const bodyId of pending) {
      debris.despawn(bodyId);
    }
  }

  return { process };
}
