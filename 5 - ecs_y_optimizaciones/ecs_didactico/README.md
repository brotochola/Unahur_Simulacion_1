# ECS didáctico (mínimo)

Versión chica de un **ECS de libro**, pensada para entender la forma del patrón.
La carpeta hermana `ecs_chiquito_con_renderers` apunta a otra cosa: data-oriented + varios backends de render. **No es ECS completo** (ahí el tipo elige los sistemas y no hay componentes opcionales).

---

## Cómo ejecutar

```bash
npx serve .
```

Abrir `http://localhost:3000`.

Vas a ver puntos rojos moviéndose (peces) y cinco puntos cyan quietos (anclas). Arriba a la izquierda, un HUD con timings del frame.

---

## Qué es ECS

Tres roles que no se pisan:

| Rol | Qué es acá | Responsabilidad |
|---|---|---|
| **Entity** | un número (`id`) | “existe alguien” |
| **Component** | un store de datos (`Position`, `Velocity`) | “qué datos tiene” |
| **System** | una función que hace `query(...)` | “qué se hace cada frame” |

La regla: **los datos no saben moverse ni dibujarse**. Los sistemas no guardan entidades adentro: preguntan al mundo quién tiene los componentes que necesitan.

### Composición (por qué importa)

Un pez se arma así:

```js
const id = world.createEntity();
world.addComponent(id, Position, { x, y });
world.addComponent(id, Velocity, { vx, vy });
```

Un ancla solo tiene `Position`. Mismo `createEntity`, distinta combinación.

- `physicsSystem` y `boundsSystem` piden `query(Position, Velocity)` → solo los peces.
- `renderSystem` pide `query(Position)` → peces **y** anclas.

Nadie escribió `if (esPez)`. La diferencia la marcan los componentes.

---

## Un frame

```
requestAnimationFrame
        │
        ▼
   world._loop
        │
        ├─ update(dt)          → physics + bounds   (processMs)
        └─ renderSystem(dt)    → canvas             (renderMs)
```

Los sistemas de lógica se registran con `addSystem`. El dibujo va aparte con `setRenderSystem`, para poder medir proceso y render por separado. **Ninguna entidad declara qué sistemas la usan.** Eso es lo que diferencia este código del de `ecs_chiquito_con_renderers`, donde aparece algo como:

```js
static systems = [PhysicsSystem, KeepWithinBoundsSystem, PreRenderSystem];
```

Ahí el **tipo** elige los sistemas. Acá el sistema elige por **query de componentes**.

### HUD

| Línea | Qué es |
|---|---|
| `dt` | tiempo real entre frames (ms). Puede ser &lt; 16 si el monitor / browser va más rápido que 60 Hz |
| `process` | ms en sistemas de lógica (`update`) |
| `render` | ms en el sistema de dibujo |

Números crudos del frame actual (sin promedio).

---

## API del World

```js
createEntity()
destroyEntity(id)
addComponent(id, Store, data)
removeComponent(id, Store)
has(id, Store)
get(id, Store)          // slot denso en el store
query(StoreA, StoreB)   // ids que tienen todos
addSystem(fn)           // lógica
setRenderSystem(fn)     // dibujo (medido aparte)
setHud(el)
start()
```

`query` es naive a propósito: recorre el primer store y filtra con `has`. Alcanza para enseñar la idea. Un motor real usaría arquetipos o sparse sets; acá no hace falta.

---

## Cómo están guardados los componentes

Cada componente es un **store SoA**:

```
Position.x:  [x0, x1, x2, ...]
Position.y:  [y0, y1, y2, ...]
Position._entity[slot] → id
Position._slot[id]     → slot
```

Agregar / sacar usa swap-and-pop (la última fila viva pisa a la que se va). Misma idea que en el proyecto hermano, pero **por componente**, no por “clase pez con x,y,vx,vy juntos”.

### Array vs TypedArray

Hay dos backends con la misma API:

| | `componentStore.js` | `componentStoreTyped.js` |
|---|---|---|
| Campos | `Array` (crece solo) | `Float32Array` |
| Mapas id ↔ slot | `Array` | `Int32Array` |
| Capacidad | implícita | fija en el ctor (default 1024, sin grow) |

Para cambiar, flippear el import en `components.js`:

```js
import { ComponentStore } from "./componentStore.js";
// import { ComponentStore } from "./componentStoreTyped.js";
```

Los sistemas no se enteran: siguen leyendo `Position.x[slot]`. TypedArrays dan layout fijo y mejor localidad; el precio es el techo de capacidad (si `add` se pasa, return `-1`).

---

## Archivos

```
ecs_didactico/
├── main.js                 spawn + registro de sistemas
├── world.js                entidades, componentes, query, loop + timings
├── components.js           elige backend + exporta Position, Velocity
├── componentStore.js       store con arrays JS
├── componentStoreTyped.js  store con TypedArrays (capacity fija)
├── physicsSystem.js        mueve quien tiene Position + Velocity
├── boundsSystem.js         rebote en bordes
├── renderSystem.js         Canvas 2D
├── index.html
└── render.css
```

Orden de lectura: `main.js` → `world.js` → `components.js` → un store → un sistema cualquiera.

---

## Contraste con `ecs_chiquito_con_renderers`

| | Este proyecto | Carpeta hermana |
|---|---|---|
| Entity | id numérico | clase / pool tipado (`Fish`) |
| Componentes | opcionales, por store | layout fijo `x,y,vx,vy` |
| Sistemas | `query(A, B)` | `Fish.systems = [...]` |
| Render | un Canvas 2D | 4 backends (software, canvas, HTML, Three) |
| Objetivo | entender ECS de libro | performance + backends de dibujo |

Misma simulación de fondo (cosas que se mueven y rebotan). Prioridades distintas.
