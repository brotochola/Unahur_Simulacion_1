# Motor data-oriented — pools, sistemas y renderers

Proyecto de **Simulación 1**. Un motor mínimo, escrito desde cero, que mueve miles de entidades en pantalla. El objetivo no es el pez en sí: es entender **cómo se organiza un simulador** cuando el cuello de botella es recorrer datos, no dibujar un sprite.

Hay cuatro formas de pintar la misma escena (software, Canvas 2D, HTML y Three.js/WebGPU). La simulación no cambia. Solo cambia el backend gráfico.

---

## Qué es esto (y qué no es)

Este código **no es un ECS de libro**.

En un ECS (*Entity Component System*) de verdad:

- la **entidad** es solo un id numérico
- los **componentes** son bloques de datos opcionales (`Position`, `Velocity`, …) que se pegan y se sacan
- los **sistemas** preguntan “¿quién tiene Position **y** Velocity?” con un `query` — nadie se anota en la entidad

Acá pasa otra cosa, más cercana a **pools homogéneos data-oriented + sistemas**:

| Pieza | Qué hay en este proyecto |
|---|---|
| Entidad | un tipo (`Fish`) con layout fijo `x, y, vx, vy` |
| “Componentes” | columnas del SoA del pool — no son opcionales ni composables |
| Sistemas | lógica afuera de los datos, pero el **tipo** declara cuáles lo tocan (`Fish.systems = [...]`) |
| Render | backend intercambiable (Strategy), aparte del update |

Es una mezcla útil: toma de ECS el desacople dato/lógica y el layout SoA, pero **no** la composición por componentes ni las queries. El tipo es el arquetipo, y el arquetipo elige los sistemas.

Si querés ver el ECS mínimo de libro (entity = id, `addComponent`, `query`), está en la carpeta hermana:

**[`../ecs_didactico/`](../ecs_didactico/)**

Misma idea de simulación (cosas que se mueven y rebotan). Prioridades distintas: allá la forma del patrón; acá performance, pools densos y cuatro backends de dibujo.

---

## Cómo ejecutar

Los módulos ES no cargan con `file://`. Hace falta un servidor local:

```bash
npx serve .
```

Abrir `http://localhost:3000`.

El renderer se elige en `main.js`, comentando y descomentando:

```js
renderer: SoftwareRenderSystem   // CPU, un píxel por entidad
renderer: RenderSystem            // Canvas 2D del browser
renderer: HtmlRenderSystem        // un <div> por sprite
renderer: ThreeRenderSystem       // GPU, InstancedMesh
```

---

## Qué hace el programa, en una frase

Crea un mundo de 800×600, reserva lugar para 10.000 peces, spawnea 1.000 con posición y velocidad al azar, y entra en un loop infinito: **mover → rebotar en los bordes → armar la lista de lo visible → dibujar**.

Eso es todo el “juego”. El resto del código existe para que ese loop sea barato, predecible y fácil de extender.

---

## Cómo se organiza el código

Tres capas que no se pisan del todo:

1. **Datos** (`Fish`): pool SoA + create/destroy. Sin lógica de física ni de dibujo.
2. **Sistemas** (`PhysicsSystem`, `KeepWithinBoundsSystem`, `PreRenderSystem`): solo lógica. Reciben el pool y lo recorren.
3. **World**: registra tipos, calcula `deltaTime`, corre los sistemas y llama al renderer.

La regla práctica: **los datos no saben dibujarse ni moverse**. La lógica no guarda un pez adentro. El mundo solo orquesta.

Si se pensara en objetos clásicos, cada pez sería algo así:

```js
class Fish {
  x; y; vx; vy;
  update(dt) { this.x += this.vx * dt; /* ... */ }
  draw(ctx)  { ctx.fillRect(this.x, this.y, 2, 2); }
}
```

Eso funciona con 20 peces. Con 10.000 aparece el problema: el CPU salta de objeto en objeto (cada uno en un lugar distinto de memoria), mezcla física con dibujo, y para agregar “rebotar en bordes” hay que tocar la clase `Fish`. Acá se da vuelta la mesa:

1. Todos los `x` viven juntos, todos los `y` juntos, etc.
2. Un sistema de física recorre **solo** esas columnas y escribe las nuevas posiciones.
3. Un sistema de dibujo ni se entera de la velocidad (lee la `RenderQueue`).
4. Para agregar un comportamiento nuevo se agrega un sistema y se lo lista en `Fish.systems` — no se infla un `update()` monstruo.

Cada tipo de entidad declara qué sistemas la procesan. En `fish.js`:

```js
static systems = [PhysicsSystem, KeepWithinBoundsSystem, PreRenderSystem];
```

Eso **no** es una query de componentes: es “este arquetipo se suscribe a estos sistemas”. `World.registerEntityClass(Fish, 10000)` lee esa lista, mete el pool de peces en cada `system.targets`, y registra el sistema en el mundo si todavía no estaba. A partir de ahí, cada frame el mundo llama `system.update(dt)` y cada sistema recorre sus pools.

El renderer **no** está en `Fish.systems`. No es un sistema de simulación: es un backend que el `World` llama aparte, después del update. Por eso se puede cambiar Three.js por un canvas sin tocar un solo pez.

---

## Un frame, de punta a punta

El tiempo real lo marca `requestAnimationFrame`. El browser llama al loop cuando está por pintar un cuadro (típicamente 60 veces por segundo).

```
requestAnimationFrame
        │
        ▼
   World._loop()
        │
        ├─ 1. World.update()
        │      calcula deltaTime
        │      por cada sistema:
        │         PhysicsSystem          → mueve
        │         KeepWithinBoundsSystem → rebota
        │         PreRenderSystem        → culling + Y-sort
        │
        └─ 2. renderer.draw()
               lee la RenderQueue y pinta
```

`deltaTime` es el tiempo transcurrido desde el frame anterior, en segundos. Si un cuadro tardó 16 ms, `dt ≈ 0.016`. La física hace `posición += velocidad × dt`, así un pez a 120 px/s recorre ~2 píxeles por cuadro a 60 fps, y ~4 si el fps se cae a la mitad. Sin `dt`, la simulación correría más rápido en una máquina rápida.

El FPS que se ve en `world.fps` no se mide por frame: se cuentan cuadros durante un segundo y se promedia. Evita que el número tiemble.

---

## Cómo viven los peces en memoria

### SoA en vez de un array de objetos

La forma habitual (*Array of Structures*) es un array de objetos:

```
[ {x, y, vx, vy}, {x, y, vx, vy}, {x, y, vx, vy}, ... ]
```

Cada objeto es un globo aparte en el heap. Recorrer `x` implica saltar de globo en globo.

Acá se usa *Structure of Arrays*: cuatro typed arrays paralelos, del mismo largo.

```
x:  [x0, x1, x2, x3, ...]
y:  [y0, y1, y2, y3, ...]
vx: [vx0, vx1, vx2, ...]
vy: [vy0, vy1, vy2, ...]
```

El pez `j` es “la columna `j`”: `x[j]`, `y[j]`, `vx[j]`, `vy[j]`. El loop de física queda lineal, sin buscar propiedades dentro de objetos. Eso es lo que el CPU hace bien: leer memoria contigua.

Se usan `Float32Array` (y `Uint16Array` para índices) porque ocupan menos que un `Array` de numbers, y porque el layout es fijo desde el primer instante.

### Pool: se reserva todo al inicio

`Fish.init(10000)` no crea 10.000 objetos pez para el simulador. Alloca los arrays una vez, al máximo. Durante el juego **no hay `new` en el loop**. Crear un pez es sacar un id libre; destruirlo es devolverlo. Eso se llama object pooling, y acá el “objeto” ni siquiera hace falta para simular: el pool son los arrays.

### Lista compacta

Los datos vivos siempre están al frente, en `[0 .. _activeCount)`. Si hay 1.000 peces activos, el sistema recorre `j = 0 .. 999` y listo. No hay huecos, no hay `if (pez.activo)` adentro del loop caliente.

### Dos identidades: id lógico vs posición de datos

El id que vos tenés en la mano (el `.index` de la fachada) **nunca cambia**. La fila donde viven sus números **sí puede cambiar**, cuando otro pez se destruye y hay que compactar.

Dos tablas bidireccionales mantienen el mapa:

- `_dataPos[id]` → en qué fila del SoA está ese id
- `_entity[fila]` → qué id es dueño de esa fila

### create() — O(1)

1. Saca un id del free list (una pila de ids libres).
2. Le asigna la siguiente fila libre: `_activeCount`.
3. Anota el mapa id ↔ fila.
4. Incrementa `_activeCount`.
5. Devuelve la fachada ya construida, `instances[id]`.

Los números del pez nuevo arrancan en 0 (typed array). `main.js` les pone `x`, `y`, `vx`, `vy` después.

### destroy() — swap-and-pop, O(1)

No se recorre el array borrando un elemento del medio. Se copia el **último** vivo encima del muerto y se achica el contador.

Ejemplo, cinco peces, se mata el de la fila 2:

```
antes:   filas  0    1    2    3    4      _activeCount = 5
         x[]  [xA,  xB,  xC,  xD,  xE]

después: filas  0    1    2    3
         x[]  [xA,  xB,  xE,  xD]          _activeCount = 4
```

`C` volvió al free list. `E` sigue siendo `E`; solo se movió de fila. Por eso los getters no leen `x[this.index]`, leen `x[_dataPos[this.index]]`.

### La clase Fish es una fachada, no el pez

`Fish.create()` no inventa un objeto nuevo cada vez. En `init` se preconstruyen 10.000 instancias, una por id lógico. Esa instancia solo traduce:

```js
get x()      { return Fish.x[Fish._dataPos[this.index]]; }
set x(v)     { Fish.x[Fish._dataPos[this.index]] = v; }
```

Sirve para el código de spawn y para mirar un pez desde la consola (`Fish.create()`, `fish.x = 10`). El loop de física **no pasa por los getters**: lee `pool.x[j]` directo.

---

## Sistemas: lógica sin datos propios

`UpdateSystem` es la clase base. Define el loop de afuera:

```text
para cada pool en this.targets:
    this.updatePool(pool, dt)
```

Las subclases **no** reimplementan ese loop. Implementan `updatePool`. Como los métodos son `static`, cuando `PhysicsSystem.update(dt)` corre, `this` es `PhysicsSystem` y `this.targets` es la lista de pools de física, no la de la clase base. Cada subclase declara `static targets = []` para no compartir el array.

Los sistemas asumen un layout: arrays `x, y, vx, vy` y un `_activeCount`. No preguntan “¿tiene el componente Velocity?”. Si otro tipo trae los mismos nombres, la física “funciona” por duck typing de columnas, no por composición.

### PhysicsSystem — integración de Euler

El método numérico más simple que hay:

```
x += vx * dt
y += vy * dt
```

Se asume que la velocidad es constante durante el intervalo. Para puntos que rebotan en un rectángulo, alcanza. El loop es:

```js
for (let j = 0; j < _activeCount; j++) {
  x[j] += vx[j] * dt;
  y[j] += vy[j] * dt;
}
```

Cero indirección, cero branches, stride 1. Ese es el “hot path” que SoA + lista compacta están protegiendo.

### KeepWithinBoundsSystem — rebote elástico

Lee el tamaño del mundo (`World.instance.width/height`). Si un pez se fue de `[0, width] × [0, height]`, lo pega al borde y niega esa componente de velocidad:

- `x < 0` → `x = 0`, `vx = -vx`
- lo mismo para el resto de los lados

No es física de colisión entre peces. Es “esta caja es el acuario”.

### PreRenderSystem — qué se dibuja, y en qué orden

Este sí pisa `update()` entero, porque necesita **una pasada sobre todos los pools a la vez**, no una pasada por tipo. Hace dos cosas, ninguna de las cuales pinta un píxel:

1. **Culling.** Si el pez está fuera del viewport, no entra a la cola. No tiene sentido pedirle al renderer que dibuje lo que no se ve.
2. **Y-sort.** En 2D, “lo de más abajo en pantalla tapa a lo de más arriba”. Ordenar por `y` creciente da esa profundidad barata, sin z-buffer.

El sort es insertion sort sobre un array de índices (`order[]`), no sobre las posiciones. Mover enteros es barato; clonar la cola no. Es estable y, para N del orden de miles, suficiente. Empate en `y` se desempata por índice, para que dos peces en la misma fila no permuten de cuadro a cuadro (flicker).

---

## RenderQueue: el contrato entre simulación y dibujo

Después de `PreRenderSystem`, la cola queda así (otra vez SoA):

| Array | Significado |
|---|---|
| `poolId[k]` | qué tipo de entidad es la entrada `k` |
| `index[k]` | fila compacta de ese pool (`x[j]`, `y[j]`) |
| `y[k]` | la clave del sort |
| `order[k]` | permutación: el `k`-ésimo en dibujarse es la entrada `order[k]` |
| `count` | cuántas entradas son válidas este frame |
| `pools[]` | tabla `poolId →` clase (`Fish`, etc.) |

Un renderer, cualquiera, hace siempre lo mismo:

```js
for (let k = 0; k < count; k++) {
  const i = order[k];              // posición ya ordenada por Y
  const pool = pools[poolId[i]];
  const j = index[i];
  // dibujar en (pool.x[j], pool.y[j])
}
```

Ahí está el patrón Strategy: el `World` llama `renderer.draw()` y no pregunta si hay GPU, canvas o divs. El contrato es `init`, `registerPool`, `draw`, `viewportWidth`, `viewportHeight`. Cumplís eso y sos un renderer.

---

## Los cuatro renderers

Misma cola, distinto costo y distinta lección.

### SoftwareRenderSystem — el píxel a mano

Un `ArrayBuffer` del tamaño `ancho × alto × 4` bytes. Encima hay dos vistas del **mismo** buffer:

- `Uint32Array` (`pixels32`): escribir un color completo en una sola asignación
- `Uint8ClampedArray` (`pixels8`): lo que `ImageData` necesita

No hay copia entre ellas. El pipeline es `clear` → `setPixel` por entidad → `putImageData` una vez. El color se empaqueta little-endian: `R | G<<8 | B<<16 | A<<24`.

Acá se ve qué hace un rasterizador cuando nadie te regala `fillRect`. Hay `drawRect` y Bresenham (`drawLine`) en el mismo archivo, aunque el sistema de peces solo usa un píxel.

### RenderSystem — Canvas 2D

El browser se queda con el framebuffer, el compositing y, si puede, la GPU. El código es `clearRect` + `fillRect` de 2×2. Es el más corto, y el que menos enseña de hardware: enseña el contrato del renderer.

### HtmlRenderSystem — el compositor del browser

Un `<div class="sprite">` por slot del pool, creados todos en `registerPool` (otra vez: nada de crear DOM en el loop). Cada frame:

1. Se ocultan los divs de las entidades vivas.
2. Los de la cola se muestran, se les pone `z-index` según el Y-sort, y se mueven con `translate3d(x, y, 0)`.

`will-change: transform` en `render.css` le pide al browser una capa de compositing. Mover transformaciones es trabajo del compositor, no del hilo de JavaScript. Con pocos sprites se siente milagroso; con miles el DOM se vuelve el problema.

### ThreeRenderSystem — un draw call para todos

Un `InstancedMesh`: la geometría del quad se manda **una vez**, y por instancia viaja una matriz 4×4 (posición). Mil peces no son mil draw calls.

Detalles que importan:

- Cámara **ortográfica** con `top = H` y `bottom = 0`, para que Y crezca hacia abajo como en canvas. Three.js es Y-up por defecto.
- `init()` es `async`: WebGPU tiene que pedir adapter y device al sistema operativo antes de dibujar. El `World` guarda esa Promise en `_rendererReady` y no arranca el loop hasta que resuelve. Canvas y software son síncronos; el mundo no distingue, solo hace `.then()`.
- Cada frame se rellenan las matrices con un `Object3D` scratch (`_dummy`) para no allocar. El eje Y se invierte (`viewH - y`). Un Z mínimo según el orden de la cola hace que el Y-sort se note también en profundidad.
- `compileAsync` corre una vez con `mesh.count` todavía en la capacidad del constructor. En Three.js r171, si el primer compile ve `count ≤ 1000`, mete las matrices en un uniform buffer de 64 KB. El array real de 10.000 instancias son 640.000 bytes, WebGPU rechaza el bind group, y el renderer queda mudo. Compilar a capacidad llena fuerza el path de atributos; después sí se baja `mesh.count` a lo visible.

---

## Zero-GC: por qué el loop se ve paranoico

El garbage collector de JavaScript **pausa el hilo** para liberar memoria. En un simulador a 60 fps, una pausa de unos milisegundos se siente como un stutter.

Por eso el código del frame evita:

- `new`
- `.push()` que agrande un array
- concatenar strings
- closures nuevas (`this._boundLoop` se bindea una sola vez)

Los typed arrays se allocan en `init`. Las variables `_i`, `_id`, `_pos` de `Fish` son scratch estático. `RenderQueue` se dimensiona al registrar entidades. El precio es más código ceremonial al arrancar; el premio es un loop que no genera basura.

---

## Arranque: `main.js` y el World

```js
const world = new World({ width: 800, height: 600, renderer, viewport });
world.registerEntityClass(Fish, 10000);
world.startGameLoop();

for (let i = 0; i < 1000; i++) {
  const fish = Fish.create();
  fish.x = Math.random() * world.width;
  // ...
}
```

Orden real, que importa para Three.js:

1. El constructor llama `bootRenderer`. Si `init()` devuelve una Promise, el mundo la guarda.
2. `registerEntityClass` llama `Fish.init(10000)` **ya** (los arrays existen). El `registerPool` del renderer (crear el `InstancedMesh` o los divs) se encola **después** de que el renderer esté listo, porque la escena WebGPU todavía no existe.
3. `startGameLoop` también espera `_rendererReady`. El primer cuadro no se pide antes.
4. El `for` de spawn es síncrono: corre enseguida, con el SoA ya vivo, aunque la GPU todavía esté negociando. Cuando el loop arranca, los 1.000 peces ya tienen posición.

`index.html` solo pone el viewport de 800×600, el CSS, el import map de Three.js 0.171 y `main.js` como módulo.

Desde la consola del browser, `window.world` (y `World.instance`) dejan inspeccionar el mundo en vivo.

---

## Cómo se conecta una entidad nueva, si la hubiera

Hoy solo existe `Fish`. El mecanismo ya admite otro tipo:

1. Una clase con SoA, `init` / `create` / `destroy`, y `static systems = [...]`.
2. `world.registerEntityClass(Otra, capacidad)`.
3. Si usa `PreRenderSystem`, entra a la misma `RenderQueue` con otro `poolId`.
4. El renderer, en `registerPool`, prepara lo suyo (otro mesh, otros divs, o nada).

Física y bordes no saben qué es un pez. Saben que hay arrays `x, y, vx, vy` y un `_activeCount`. Si el nuevo tipo tiene otro layout, hay que tocar esos sistemas (o hacer otro sistema) — no alcanza con “pegarle otro componente”.

---

## Contraste con `ecs_didactico`

| | Este proyecto | [`../ecs_didactico/`](../ecs_didactico/) |
|---|---|---|
| Entity | clase / pool tipado (`Fish`) | id numérico |
| Datos | layout fijo `x,y,vx,vy` en el tipo | componentes opcionales (`Position`, `Velocity`) |
| Sistemas | el tipo declara `systems = [...]` | `world.query(Position, Velocity)` |
| Render | 4 backends | un Canvas 2D |
| Objetivo | performance + backends de dibujo | forma del patrón ECS |

---

## Estructura de archivos

```
ecs_chiquito_con_renderers/
├── main.js                   punto de entrada: World, spawn, elegir renderer
├── world.js                  orquestador: registro, dt, loop, boot del renderer
├── fish.js                   pool SoA + fachada + create/destroy
├── updateSystem.js           loop genérico de sistemas
├── physicsSystem.js          Euler: posición += velocidad × dt
├── keepWithinBoundsSystem.js rebote contra los bordes del mundo
├── preRenderSystem.js        culling + Y-sort
├── renderQueue.js            cola de dibujo (SoA)
├── renderSystem.js           Canvas 2D
├── htmlRenderSystem.js       divs + translate3d
├── softwareRenderSystem.js   framebuffer en CPU
├── threeRenderSystem.js      InstancedMesh + WebGPU
├── index.html                viewport + import map
└── render.css                viewport y sprites HTML
```

El orden de lectura que más rinde: `main.js` → `world.js` → `fish.js` → `updateSystem.js` y los tres sistemas → `renderQueue.js` → un renderer, el que más te interese. El resto son el mismo `draw()` con distinta herramienta.

Para el ECS de libro: abrir [`../ecs_didactico/`](../ecs_didactico/) y empezar por `main.js` → `world.js` → `components.js`.
