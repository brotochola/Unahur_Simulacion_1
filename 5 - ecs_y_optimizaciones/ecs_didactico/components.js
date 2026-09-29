// Instancias de componentes. Flippear el import para Array vs TypedArray.
// import { ComponentStore } from "./componentStore.js";
import { ComponentStore } from "./componentStoreTyped.js";
import { MAX_ENTITIES } from "./config.js";

export const Position = new ComponentStore(["x", "y"], MAX_ENTITIES);
export const Velocity = new ComponentStore(["vx", "vy"], MAX_ENTITIES);
