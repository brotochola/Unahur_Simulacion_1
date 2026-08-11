import { SCALE } from './config.js';

export const toScreenX = (mx) => mx * SCALE;
export const toScreenY = (my) => -my * SCALE;

export function toWorldXY(sx, sy) {
  return { x: sx / SCALE, y: -sy / SCALE };
}

/** Fresh b2Vec2 every call — Box2D stores position by reference. */
export function toWorldVec(b2Vec2, sx, sy) {
  return new b2Vec2(sx / SCALE, -sy / SCALE);
}

export const terrainKey = (col, row) => (col << 16) ^ (row & 0xffff);

export function bodyKey(bodyId) {
  if (!bodyId) return '';
  return bodyId.index1 + ':' + bodyId.revision;
}
