export class RenderQueue {
  static poolId = null;
  static index = null;
  static y = null;
  static order = null;
  static count = 0;
  static pools = [];
  static capacity = 0;

  static init(capacity) {
    this.capacity = capacity;
    this.poolId = new Uint8Array(capacity);
    this.index = new Uint16Array(capacity);
    this.y = new Float32Array(capacity);
    this.order = new Uint32Array(capacity);
    this.count = 0;
    this.pools.length = 0;
  }

  static registerPool(entityClass) {
    if (entityClass.poolId !== -1) return entityClass.poolId;
    entityClass.poolId = this.pools.length;
    this.pools.push(entityClass);
    return entityClass.poolId;
  }
}
