# Unidad 5 en WeedJS: caso de estudio

Repo: [github.com/brotochola/Web-Engine-for-Enhanced-Dynamics](https://github.com/brotochola/Web-Engine-for-Enhanced-Dynamics)
Demo en vivo: [multithreaded-game-engine.vercel.app/demos](https://multithreaded-game-engine.vercel.app/demos)

WeedJS es un motor de juegos 2D multithreaded que soporta más de 20.000 entidades activas a la vez, y prácticamente cada técnica de la Unidad 5 aparece implementada (y documentada) en el proyecto real, no solo en teoría.

---

### 1. Big O aplicado a simulaciones
El `spatial_worker` particiona el mundo en una grilla y cada worker es dueño de un rango de filas. Para buscar vecinos de una entidad, en vez de compararla contra las demás (O(n²)), recorre solo las celdas cercanas de la grilla. Está documentado en `docs/SPATIAL_HASHING.md`.

### 2. AoS vs SoA / Data-Oriented Design
Cada componente (`Transform`, `RigidBody`, `Collider`, `SpriteRenderer`) se guarda como **Structure of Arrays** explícita: todos los `x` juntos, todos los `y` juntos, en un `SharedArrayBuffer` contiguo por campo, en vez de un objeto por entidad. Es política de diseño documentada en `docs/COMPONENT_STORAGE.md`, con componentes "SoA opcionales" que solo se asignan si la escena realmente los usa.

### 3. Cache misses y comportamiento del GC
El motor evita crear objetos por entidad en el heap de JS (todo vive en typed arrays), lo que reduce drásticamente la presión sobre el garbage collector. Además, el spatial worker mantiene un caché `entityPosData` con `[x, y, halfExtent]` intercalado específicamente para mejorar la localidad de caché al chequear distancias entre vecinos.

### 4. Método científico aplicado a la optimización
Existe un documento propio de metodología de benchmarking (`tests/bench/BENCHMARK_METHODOLOGY.md`) que sigue el método científico casi al pie de la letra: hipótesis, mantener todo lo demás constante, variables de respuesta primarias (`STEP_MS`, `Load%`), chequeo de equivalencia entre corridas, y replicación con 5 o más corridas reportando mediana y coeficiente de variación.

### 5. Benchmarking comparativo
Usan una escena de stress (`BallsScene`) con Playwright para correr benchmarks automatizados: 25s de warmup, 18s de medición, y comparaciones "apareadas" (baseline → N corridas → cambio → N corridas) en la misma máquina — el mismo espíritu que comparar Juego de la Vida OOP vs SoA, pero aplicado a su propio motor en producción.

### 6. WebAssembly
La física no está reimplementada en JS: corre sobre **Box2D 3.0**, la librería en C real compilada a WebAssembly (con SIMD y pthreads), integrada como worker de física. Es el ejemplo más directo de usar WASM para la parte del motor más pesada en cómputo.

### 7. Bitwise Operations
Los filtros de colisión (`collisionLayer` / `collisionMask`) se resuelven con chequeos de bits mutuos (patrón estándar de layers en game engines), y las banderas de "qué cambió" en una entidad (`LIFECYCLE|GEOMETRY|MASS`, etc.) se combinan con OR bit a bit en un solo entero en vez de usar varios booleans sueltos.

### 8. Multithreading (Web Workers)
El motor reparte el trabajo en 7 Web Workers dedicados (spatial, physics, logic, particle, pre-render, pixi, audio) que comparten memoria vía `SharedArrayBuffer`, con la regla de **"un solo escritor por región"** para evitar locks. Esto es justamente lo que le permite manejar 20.000+ NPCs sin trabar el hilo principal ni el renderizado.

---

En resumen: WeedJS no es un ejemplo académico de estas técnicas, es un motor real que las combina todas juntas — por eso funciona bien como cierre de la unidad, pidiéndoles a los alumnos que tomen una de estas piezas (por ejemplo `docs/SPATIAL_HASHING.md` o `docs/COMPONENT_STORAGE.md`) y repliquen el razonamiento de optimización sobre un caso más chico.
