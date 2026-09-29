# ECS didáctico (mínimo)

Versión chica de un **ECS de libro**, pensada para entender la forma del patrón.
La carpeta hermana `ecs_chiquito_con_renderers` apunta a otra cosa: data-oriented + varios backends de render. **No es ECS completo** (ahí el tipo elige los sistemas y no hay componentes opcionales).

---

## Cómo ejecutar

```bash
npx serve .
```

Abrir `http://localhost:3000`.

Vas a ver puntos rojos moviéndose (peces) y cinco puntos cyan quietos (anclas).

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
   world.update(dt)
        │
        ├─ physicsSystem   → query(Position, Velocity) → mueve
        ├─ boundsSystem    → query(Position, Velocity) → rebota
        └─ renderSystem    → query(Position)           → dibuja
```

Los sistemas se registran en el World (`addSystem`). **Ninguna entidad declara qué sistemas la usan.** Eso es lo que diferencia este código del de `ecs_chiquito_con_renderers`, donde aparece algo como:

```js
static systems = [PhysicsSystem, KeepWithinBoundsSystem, PreRenderSystem];
```

Ahí el **tipo** elige los sistemas. Acá el sistema elige por **query de componentes**.

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
addSystem(fn)
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

---

## Archivos

```
ecs_didactico/
├── main.js             spawn + registro de sistemas
├── world.js            entidades, componentes, query, loop
├── components.js       Position, Velocity (stores)
├── physicsSystem.js    mueve quien tiene Position + Velocity
├── boundsSystem.js     rebote en bordes
├── renderSystem.js     Canvas 2D
├── index.html
└── render.css
```

Orden de lectura: `main.js` → `world.js` → `components.js` → un sistema cualquiera.

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
