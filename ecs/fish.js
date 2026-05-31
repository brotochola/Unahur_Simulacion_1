import { PhysicsSystem } from "./physicsSystem.js";
import { KeepWithinBoundsSystem } from "./keepWithinBoundsSystem.js";
import { PreRenderSystem } from "./preRenderSystem.js";

export class Fish {
  // =====================================================================
  // ARQUITECTURA: LAYOUT COMPACTO (Dense SoA)
  //
  // Los data arrays (x, y, vx, vy) están SIEMPRE compactos:
  // las posiciones [0 .. _activeCount-1] contienen datos válidos,
  // sin huecos. Esto significa que tickAll() puede iterar linealmente
  // sin ninguna tabla de indirección, maximizando cache hits.
  //
  // Para lograr esto, cada entidad tiene:
  //   - Un ID LÓGICO estable (nunca cambia, es el .index de la facade)
  //   - Una POSICIÓN DE DATOS que SÍ puede cambiar (cuando otra entidad
  //     es destruida y se hace swap-and-pop)
  //
  // Dos mapeos bidireccionales mantienen la coherencia:
  //   _dataPos[id]   → en qué posición del array está mi data
  //   _entity[pos]   → qué ID lógico es dueño de esta posición
  //
  // Costo del tradeoff:
  //   - tickAll(): 0 indirección (antes: 1 lookup en _active por iteración)
  //   - getters/setters: 1 lookup extra en _dataPos (antes: directo)
  //   - destroy(): copia 4 floats extra (swap de datos)
  //
  // Net win: el hot loop es ~2x más cache-friendly, y el costo extra
  // en destroy/getters se paga fuera del inner loop.
  // =====================================================================

  // =====================================================================
  // DATA — Float32Arrays compactos, posiciones [0.._activeCount) válidas
  // =====================================================================
  static x = null;
  static y = null;
  static vx = null;
  static vy = null;

  // =====================================================================
  // FREE LIST — stack de IDs lógicos disponibles
  // =====================================================================
  static _freeList = null;
  static _freeHead = 0;

  // =====================================================================
  // _dataPos[logicalId] = posición actual en los data arrays
  // Permite que la facade (getters/setters) encuentre dónde vive su data.
  // Se actualiza en destroy() cuando un swap mueve datos de posición.
  // =====================================================================
  static _dataPos = null;

  // =====================================================================
  // _entity[dataPos] = ID lógico dueño de esa posición
  // Permite que destroy() sepa a quién pertenece el último slot
  // para poder actualizar su _dataPos después del swap.
  // =====================================================================
  static _entity = null;

  // =====================================================================
  // ACTIVE COUNT — la zona válida de los data arrays es [0, _activeCount)
  // =====================================================================
  static _activeCount = 0;

  // =====================================================================
  // INSTANCIAS PRE-CONSTRUIDAS
  // =====================================================================
  static instances = null;

  // =====================================================================
  // SCRATCH — variables reutilizables, zero-alloc
  // =====================================================================
  static _i = 0;
  static _id = 0;
  static _pos = 0;
  static _lastPos = 0;
  static _lastEntity = 0;
  static _resultBuf = null;
  static _capacity = 0;
  static poolId = -1;

  static systems = [PhysicsSystem, KeepWithinBoundsSystem, PreRenderSystem];

  // =====================================================================
  // INIT — allocatea todo una sola vez
  //
  // Estado post-init:
  //   data arrays = [capacity floats, todos 0]
  //   _freeList   = [0, 1, 2, ..., capacity-1]  (todos libres)
  //   _freeHead   = capacity                     (stack lleno)
  //   _activeCount = 0                           (nadie vivo)
  // =====================================================================
  static init(capacity = 1000) {
    this._capacity = capacity;

    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);

    this._freeList = new Uint16Array(capacity);
    for (let i = 0; i < capacity; i++) this._freeList[i] = i;
    this._freeHead = capacity;

    this._dataPos = new Uint16Array(capacity);
    this._entity = new Uint16Array(capacity);
    this._activeCount = 0;

    this.instances = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.instances[i] = new Fish();
      this.instances[i].index = i;
    }

    this._resultBuf = new Array(capacity);
  }

  // =====================================================================
  // CREATE — O(1), zero-alloc
  //
  // Flujo:
  //   1. Pop un ID lógico libre del free stack
  //   2. Asigna posición de datos = _activeCount (final de la zona activa)
  //   3. Registra mapeos: _dataPos[id] = pos, _entity[pos] = id
  //   4. Incrementa _activeCount
  //   5. Retorna la facade pre-construida (instances[id])
  //
  // Después de create(), los datos del nuevo pez están en la última
  // posición de la zona compacta (inicializados en 0 por el TypedArray).
  // =====================================================================
  static create() {
    this._id = this._freeList[--this._freeHead];
    this._pos = this._activeCount;

    this._dataPos[this._id] = this._pos;
    this._entity[this._pos] = this._id;
    this._activeCount++;

    return this.instances[this._id];
  }

  // =====================================================================
  // DESTROY — O(1), zero-alloc, swap-and-pop EN LOS DATOS
  //
  // Ejemplo visual (destroy pez con id=C, que está en dataPos=2):
  //
  //   Antes:
  //     pos:      0    1    2    3    4
  //     x[]:   [ xA , xB , xC , xD , xE ]    _activeCount = 5
  //     entity:[ A  , B  , C  , D  , E  ]
  //
  //   Paso 1 — swap datos del último (pos 4) → pos del muerto (pos 2):
  //     x[2] = x[4],  y[2] = y[4],  vx[2] = vx[4],  vy[2] = vy[4]
  //
  //   Paso 2 — actualizar mapeos para E (el que se movió):
  //     _entity[2] = E
  //     _dataPos[E] = 2
  //
  //   Paso 3 — decrementar _activeCount, push C al free list
  //
  //   Después:
  //     pos:      0    1    2    3
  //     x[]:   [ xA , xB , xE , xD ]    _activeCount = 4
  //     entity:[ A  , B  , E  , D  ]
  //
  //   → Compacto, sin huecos. tickAll sigue iterando [0..3] linealmente.
  //   → La facade de E (instances[E]) sigue funcionando: su .index no
  //     cambió, solo _dataPos[E] ahora apunta a 2 en vez de 4.
  // =====================================================================
  destroy() {
    Fish._id = this.index;
    Fish._pos = Fish._dataPos[Fish._id];
    Fish._lastPos = --Fish._activeCount;
    Fish._lastEntity = Fish._entity[Fish._lastPos];

    Fish.x[Fish._pos] = Fish.x[Fish._lastPos];
    Fish.y[Fish._pos] = Fish.y[Fish._lastPos];
    Fish.vx[Fish._pos] = Fish.vx[Fish._lastPos];
    Fish.vy[Fish._pos] = Fish.vy[Fish._lastPos];

    Fish._entity[Fish._pos] = Fish._lastEntity;
    Fish._dataPos[Fish._lastEntity] = Fish._pos;

    Fish._freeList[Fish._freeHead++] = Fish._id;
  }

  // =====================================================================
  // GETTERS / SETTERS — fachada OOP
  // Resuelven a través de _dataPos[this.index] para encontrar la posición
  // actual en el array compacto. Un nivel de indirección aquí es aceptable
  // porque estos se usan en código de gameplay (fuera del hot loop).
  // =====================================================================
  get x() {
    return Fish.x[Fish._dataPos[this.index]];
  }
  set x(v) {
    Fish.x[Fish._dataPos[this.index]] = v;
  }

  get y() {
    return Fish.y[Fish._dataPos[this.index]];
  }
  set y(v) {
    Fish.y[Fish._dataPos[this.index]] = v;
  }

  get vx() {
    return Fish.vx[Fish._dataPos[this.index]];
  }
  set vx(v) {
    Fish.vx[Fish._dataPos[this.index]] = v;
  }

  get vy() {
    return Fish.vy[Fish._dataPos[this.index]];
  }
  set vy(v) {
    Fish.vy[Fish._dataPos[this.index]] = v;
  }

  get active() {
    Fish._pos = Fish._dataPos[this.index];
    return (
      Fish._pos < Fish._activeCount && Fish._entity[Fish._pos] === this.index
    );
  }

  // =====================================================================
  // QUERY — zero-alloc
  // =====================================================================
  static getAllActiveIndices() {
    return this._entity.subarray(0, this._activeCount);
  }

  static getAllActiveInstances() {
    for (this._i = 0; this._i < this._activeCount; this._i++) {
      this._resultBuf[this._i] = this.instances[this._entity[this._i]];
    }
    this._resultBuf.length = this._activeCount;
    return this._resultBuf;
  }
}
