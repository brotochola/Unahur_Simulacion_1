// Cola de renderizado — Structure of Arrays (SoA)
//
// Cada frame, PreRenderSystem llena esta cola con las entidades visibles,
// ordenadas por Y. Los renderers (canvas, HTML, Three.js, software) la leen
// para saber qué y en qué orden dibujar.
//
// Layout paralelo: en vez de [{poolId, index, y}, ...] (AoS),
// usamos arrays separados. Así el sort solo mueve enteros en order[],
// sin tocar los datos reales.
//
//   poolId[k]  → qué tipo de entidad es la entrada k
//   index[k]   → slot compacto en el SoA del pool (posición en x[], y[])
//   y[k]       → coordenada Y, usada como clave de ordenamiento
//   order[k]   → índice indirecto para Y-sort sin mover los otros arrays
//   count      → cantidad de entradas válidas este frame
export class RenderQueue {
  static poolId = null;   // Uint8Array  — id numérico del pool (tipo de entidad)
  static index = null;    // Uint16Array — slot en los arrays SoA del pool
  static y = null;        // Float32Array — coordenada Y (clave de sort)
  static order = null;    // Uint32Array — orden de dibujado (sort indirecto)
  static count = 0;       // entradas válidas este frame
  static pools = [];      // pools[poolId] → clase de entidad
  static capacity = 0;

  // Alloca todos los arrays una sola vez. Se llama desde PreRenderSystem.init().
  static init(capacity) {
    this.capacity = capacity;
    this.poolId = new Uint8Array(capacity);
    this.index = new Uint16Array(capacity);
    this.y = new Float32Array(capacity);
    this.order = new Uint32Array(capacity);
    this.count = 0;
    this.pools.length = 0;
  }

  // Asigna un id numérico a un pool y lo registra en la tabla de lookup.
  // Se llama desde World.registerEntityClass() cuando el pool usa PreRenderSystem.
  static registerPool(entityClass) {
    if (entityClass.poolId !== -1) return entityClass.poolId;
    entityClass.poolId = this.pools.length;
    this.pools.push(entityClass);
    return entityClass.poolId;
  }
}
