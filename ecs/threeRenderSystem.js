import * as THREE from "three/webgpu";
import { RenderQueue } from "./renderQueue.js";

export class ThreeRenderSystem {
  static _viewport = null;
  static _renderer = null;
  static _scene = null;
  static _camera = null;
  static _dummy = null;
  static _initialized = false;

  static async init(viewport) {
    const W = viewport.clientWidth;
    const H = viewport.clientHeight;

    this._viewport = viewport;
    this._renderer = new THREE.WebGPURenderer({
      antialias: false,
      alpha: false,
    });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this._renderer.setSize(W, H);
    const canvas = this._renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    viewport.appendChild(canvas);

    await this._renderer.init();

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x1a1a2e);

    // top > bottom (Three convention); flip y when placing sprites to match canvas coords
    this._camera = new THREE.OrthographicCamera(0, W, H, 0, -1000, 1000);
    this._camera.position.set(0, 0, 1);
    this._camera.lookAt(0, 0, 0);

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

  static registerPool(pool) {
    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xe94560 });
    const mesh = new THREE.InstancedMesh(geo, mat, pool._capacity);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this._scene.add(mesh);
    pool._instancedMesh = mesh;
    pool._drawCount = 0;
  }

  static async draw() {
    const { count, order, poolId, index, pools } = RenderQueue;
    const dummy = this._dummy;
    const viewH = this._viewH;

    for (let p = 0; p < pools.length; p++) {
      pools[p]._drawCount = 0;
    }

    for (let k = 0; k < count; k++) {
      const i = order[k];
      const pool = pools[poolId[i]];
      const j = index[i];
      const slot = pool._drawCount++;
      const mesh = pool._instancedMesh;

      dummy.position.set(pool.x[j], viewH - pool.y[j], -k * 0.001);
      dummy.updateMatrix();
      mesh.setMatrixAt(slot, dummy.matrix);
    }

    for (let p = 0; p < pools.length; p++) {
      const pool = pools[p];
      const mesh = pool._instancedMesh;
      mesh.count = pool._drawCount;
      mesh.instanceMatrix.needsUpdate = true;
    }

    await this._renderer.renderAsync(this._scene, this._camera);
  }
}
