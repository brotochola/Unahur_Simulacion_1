import * as THREE from "three/webgpu";
import { RenderQueue } from "./renderQueue.js";

// Renderer Three.js: usa la GPU via WebGPU (con fallback a WebGL 2).
//
// Concepto clave — InstancedMesh:
//   En vez de un draw call por entidad, se envía UNA SOLA vez a la GPU
//   la geometría del sprite, junto con una matriz de transformación por instancia.
//   Con 5000 peces → 1 draw call en lugar de 5000.
//
// Cámara ortográfica:
//   Mapea directamente coordenadas 2D del mundo a píxeles de pantalla,
//   igual que el canvas. Sin perspectiva.
//
// Init asíncrono:
//   WebGPU requiere negociar el adapter y device con el sistema operativo
//   antes de poder renderizar. Por eso init() es async.
export class ThreeRenderSystem {
  static _viewport = null;
  static _renderer = null;
  static _scene = null;
  static _camera = null;
  static _dummy = null;  // Object3D reutilizable — zero-alloc en draw()
  static _initialized = false;

  static async init(viewport) {
    const W = viewport.clientWidth;
    const H = viewport.clientHeight;

    this._viewport = viewport;
    this._renderer = new THREE.WebGPURenderer({
      antialias: false, // sin antialiasing para máximo rendimiento
      alpha: false,
    });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this._renderer.setSize(W, H);
    const canvas = this._renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    viewport.appendChild(canvas);

    // Esperar a que el backend GPU esté listo (puede ser WebGPU o WebGL2)
    await this._renderer.init();

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x1a1a2e);

    // Cámara ortográfica: (left, right, top, bottom, near, far)
    // Three.js usa Y-up, pero queremos Y-down como canvas.
    // Ponemos top=H y bottom=0 para que Y crezca hacia abajo.
    this._camera = new THREE.OrthographicCamera(0, W, H, 0, -1000, 1000);
    this._camera.position.set(0, 0, 1);
    this._camera.lookAt(0, 0, 0);

    // Object3D de scratch: se reutiliza en cada draw() para calcular matrices
    // sin crear objetos nuevos (zero GC en el hot path)
    this._dummy = new THREE.Object3D();
    this._viewW = W;
    this._viewH = H;
    this._initialized = true;
  }

  static get viewportWidth() {
    return this._viewport.clientWidth;
  }

  static get viewportHeight() {
    return this._viewport.clientHeight;
  }

  // Por cada pool, crear un InstancedMesh con capacidad máxima.
  // Se pre-alloca al máximo para no redimensionar en runtime.
  static registerPool(pool) {
    const geo = new THREE.PlaneGeometry(4, 4);  // sprite 4×4 píxeles
    const mat = new THREE.MeshBasicMaterial({ color: 0xe94560 }); // sin iluminación
    const mesh = new THREE.InstancedMesh(geo, mat, pool._capacity);
    mesh.frustumCulled = false; // el culling ya lo hace PreRenderSystem
    mesh.count = 0;
    this._scene.add(mesh);
    pool._instancedMesh = mesh;
    pool._drawCount = 0; // contador de instancias visible este frame
  }

  // Draw loop: consume la RenderQueue y actualiza las matrices de instancia.
  // renderAsync() en vez de render() es requerido por WebGPU.
  static async draw() {
    const { count, order, poolId, index, pools } = RenderQueue;
    const dummy = this._dummy;
    const viewH = this._viewH;

    // Resetear contadores de instancias por pool
    for (let p = 0; p < pools.length; p++) {
      pools[p]._drawCount = 0;
    }

    // Por cada entidad visible (en orden Y-sort), actualizar su matriz de instancia
    for (let k = 0; k < count; k++) {
      const i = order[k];
      const pool = pools[poolId[i]];
      const j = index[i];
      const slot = pool._drawCount++;
      const mesh = pool._instancedMesh;

      // Y se invierte porque Three.js tiene Y-up y el mundo tiene Y-down
      // Z se usa como pequeño offset para que el Y-sort se refleje en profundidad
      dummy.position.set(pool.x[j], viewH - pool.y[j], -k * 0.001);
      dummy.updateMatrix();
      mesh.setMatrixAt(slot, dummy.matrix);
    }

    // Actualizar cada mesh con la cantidad de instancias visibles este frame
    for (let p = 0; p < pools.length; p++) {
      const pool = pools[p];
      const mesh = pool._instancedMesh;
      mesh.count = pool._drawCount;
      mesh.instanceMatrix.needsUpdate = true;
    }

    await this._renderer.renderAsync(this._scene, this._camera);
  }
}
