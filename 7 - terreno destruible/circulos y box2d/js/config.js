export const SCALE = 30;

export const WORLD_W = 2400;
export const WORLD_H = 1400;
export const CELL = 18;
export const CIRCLE_R = 13;
export const CIRCLE_R_SMALL = CIRCLE_R / 2;
export const DIG_RADIUS = 25;

export const PHYS_RADIUS = 300;
export const PHYS_HYSTERESIS = 100;
export const LOOKAHEAD = 120;
export const CORE_KEEP = 180;
export const SYNC_MOVE = CELL;
export const BODY_POOL_SIZE = Math.ceil(Math.PI * ((PHYS_RADIUS + PHYS_HYSTERESIS + LOOKAHEAD) / CELL) ** 2) + 256;

export const DEBRIS_FULL_POOL = 96;
export const DEBRIS_SMALL_POOL = 128;

export const CAT_TERRAIN = 0x0001;
export const CAT_DEBRIS_FULL = 0x0002;
export const CAT_DEBRIS_SMALL = 0x0004;
export const CAT_PLAYER = 0x0008;

// Live bodies collide with everything. Parked debris: gravityScale 0 + far SetTransform (no Disable).
export const MASK_ALL = 0xffffffff;
export const MASK_TERRAIN = MASK_ALL;
export const MASK_DEBRIS_FULL = MASK_ALL;
export const MASK_DEBRIS_SMALL = MASK_ALL;
export const MASK_PLAYER = MASK_ALL;

export const LASER_HIT_INTERVAL_MS = 90;
export const LASER_DETACH_IMPULSE = 2.5;
export const LASER_SPLIT_IMPULSE = 4.0;

export const PARK_X = -9999 / SCALE;
export const PARK_Y = 9999 / SCALE;
