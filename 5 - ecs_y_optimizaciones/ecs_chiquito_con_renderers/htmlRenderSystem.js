import { RenderQueue } from "./renderQueue.js";

// Renderer HTML: usa divs del DOM como sprites.
//
// Cada entidad tiene un <div> pre-creado. En cada frame se mueven con
// transform: translate3d(x, y, 0), que delega el movimiento al compositor
// del browser (corre en un thread separado, no bloquea JS).
//
// will-change: transform (en render.css) le indica al browser que promueva
// estos elementos a capas de compositing independientes.
//
// Ventaja: muy fluido para pocos sprites (el compositor los mueve en GPU)
// Desventaja: el DOM tiene overhead por elemento; con miles de divs baja el rendimiento
export class HtmlRenderSystem {
  static viewport = null;

  static init(viewport) {
    this.viewport = viewport;
  }

  static get viewportWidth() {
    return this.viewport.clientWidth;
  }

  static get viewportHeight() {
    return this.viewport.clientHeight;
  }

  // Pre-crea todos los divs de una vez (evita crearlos durante el juego).
  // Se mapean al slot compacto del SoA: pool._els[j] es el div de la entidad en posición j.
  static registerPool(pool) {
    const capacity = pool._capacity;
    const els = new Array(capacity);
    const viewport = this.viewport;

    for (let i = 0; i < capacity; i++) {
      const el = document.createElement("div");
      el.className = "sprite";
      el.style.visibility = "hidden";
      viewport.appendChild(el);
      els[i] = el;
    }

    pool._els = els;
  }

  static draw() {
    const pools = RenderQueue.pools;
    const { count, order, poolId, index } = RenderQueue;

    // Primero ocultar todos los activos (los no-visibles quedan hidden)
    for (let p = 0; p < pools.length; p++) {
      const pool = pools[p];
      const els = pool._els;
      const activeCount = pool._activeCount;

      for (let j = 0; j < activeCount; j++) {
        els[j].style.visibility = "hidden";
      }
    }

    // Luego mostrar y posicionar los que están en la RenderQueue (visibles y Y-sorteados)
    for (let k = 0; k < count; k++) {
      const i = order[k];
      const pool = pools[poolId[i]];
      const j = index[i];
      const el = pool._els[j];

      el.style.visibility = "visible";
      el.style.zIndex = k; // zIndex = posición en el Y-sort → profundidad 2D
      el.style.transform =
        "translate3d(" + pool.x[j] + "px," + pool.y[j] + "px,0)";
    }
  }
}
