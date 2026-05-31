# ECS — Motor de Simulación

Proyecto educativo para la materia **Simulación 1**. Implementa un motor de simulación desde cero usando el patrón **ECS (Entity Component System)**, con cuatro backends de renderizado intercambiables.

---

## Cómo ejecutar

Requiere un servidor HTTP local (los módulos ES no funcionan con `file://`):

```bash
npx serve .
```

Luego abrir `http://localhost:3000` en el browser.

Para cambiar el renderer, editar `main.js`:

```js
renderer: SoftwareRenderSystem   // CPU, píxeles manuales
renderer: RenderSystem            // Canvas 2D del browser
renderer: HtmlRenderSystem        // Divs HTML con translate3d
renderer: ThreeRenderSystem       // GPU via Three.js / WebGPU
```

---

## Temas que cubre

### Game loop y timing

El motor corre con `requestAnimationFrame`, que sincroniza la simulación con el vsync del monitor. Se calcula `deltaTime` (tiempo entre frames) para que la física sea independiente del framerate.

**Archivo:** `world.js`

---

### ECS — Entity Component System

Separación en tres responsabilidades:

- **Entidad** (`Fish`): solo datos, sin lógica
- **Sistema** (`PhysicsSystem`, `KeepWithinBoundsSystem`, etc.): solo lógica, sin datos propios
- **Mundo** (`World`): orquesta el registro y la ejecución

Cada entidad declara qué sistemas la procesan:

```js
static systems = [PhysicsSystem, KeepWithinBoundsSystem, PreRenderSystem];
```

**Archivos:** `updateSystem.js`, `physicsSystem.js`, `keepWithinBoundsSystem.js`, `world.js`, `fish.js`

---

### SoA — Structure of Arrays

Los datos de todas las entidades se guardan en arrays paralelos separados, no como objetos individuales:

```
AoS (común):   [{x, y, vx, vy}, {x, y, vx, vy}, ...]   ← muchos objetos
SoA (este ECS): x[], y[], vx[], vy[]                     ← arrays contiguos
```

El CPU puede leer `x[0], x[1], x[2]...` en una sola línea de caché. Con AoS, cada objeto interrumpe la lectura.

**Archivo:** `fish.js`

---

### Lista compacta y swap-and-pop

Las entidades activas ocupan siempre las posiciones `[0, _activeCount)` sin huecos. Al destruir una entidad se hace swap con la última y se decrementa el contador: O(1), sin mover el resto.

Dos índices bidireccionales mantienen la coherencia entre ID lógico y posición física en el array.

**Archivo:** `fish.js` — métodos `create()` y `destroy()`

---

### Zero-GC

El garbage collector de JavaScript pausa la ejecución cuando libera memoria. Este motor evita allocaciones en el hot path:

- Typed arrays pre-allocados una sola vez en `init()`
- Variables de scratch estáticas en vez de locales
- Sin `new`, sin arrays temporales, sin string concat en el loop principal

---

### Física — Integración de Euler

```
posición += velocidad × Δt
```

El método más simple de integración numérica. Suficiente para este tipo de simulación. `KeepWithinBoundsSystem` implementa el rebote invirtiendo la componente de velocidad al tocar el borde.

**Archivos:** `physicsSystem.js`, `keepWithinBoundsSystem.js`

---

### RenderQueue y culling

Antes de dibujar, `PreRenderSystem` construye una lista de entidades visibles (dentro del viewport) y las ordena por Y. Esto separa la lógica de "qué dibujar y en qué orden" del "cómo dibujarlo".

- **Culling**: descartar entidades fuera de pantalla antes del render
- **Y-sort**: orden de dibujado para simular profundidad en 2D
- **Orden indirecto**: se ordena un array de índices (`order[]`), sin mover los datos

**Archivos:** `preRenderSystem.js`, `renderQueue.js`

---

### Cuatro renderers — mismo pipeline

Todos consumen el mismo `RenderQueue`. Solo cambia cómo se dibuja cada entidad:

| Renderer | Tecnología | Nivel |
|---|---|---|
| `SoftwareRenderSystem` | `ArrayBuffer` + `putImageData` | CPU, píxel a píxel |
| `RenderSystem` | Canvas 2D API | Browser alto nivel |
| `HtmlRenderSystem` | Divs + `translate3d` | Compositor del browser |
| `ThreeRenderSystem` | `InstancedMesh` + WebGPU/WebGL | GPU |

**Patrón Strategy**: el `World` no sabe qué renderer está usando. Solo llama `init()`, `draw()`, `registerPool()`. Cualquier objeto que implemente ese contrato funciona.

#### Software renderer

Framebuffer manual en memoria: `ArrayBuffer` → `Uint32Array` → `ImageData` → `putImageData`. El color se empaqueta como entero de 32 bits en formato little-endian (`R|G<<8|B<<16|A<<24`).

**Archivo:** `softwareRenderSystem.js`

#### Three.js renderer

Usa `InstancedMesh`: toda la pool se dibuja en un solo draw call a la GPU. Cámara ortográfica para mapear coordenadas 2D directamente. Init asíncrono porque WebGPU requiere negociar el dispositivo GPU antes de poder renderizar.

**Archivo:** `threeRenderSystem.js`

---

## Estructura de archivos

```
ecs/
├── updateSystem.js          # Clase base de sistemas
├── physicsSystem.js         # Integración de Euler
├── keepWithinBoundsSystem.js# Rebote en bordes del mundo
├── renderQueue.js           # Cola de draw commands (SoA)
├── preRenderSystem.js       # Culling + Y-sort
├── renderSystem.js          # Renderer Canvas 2D
├── htmlRenderSystem.js      # Renderer HTML divs
├── softwareRenderSystem.js  # Renderer software + rasterizador
├── threeRenderSystem.js     # Renderer Three.js / WebGPU
├── fish.js                  # Pool de entidades (SoA + swap-and-pop)
├── world.js                 # Orquestador principal
├── main.js                  # Punto de entrada
├── index.html               # HTML con importmap para Three.js
└── render.css               # Estilos base del viewport
```
