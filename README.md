# UNAHUR — Simulación 1

## Unidad 1 — Mundos procedurales 2D y 3D

- Números pseudoaleatorios con semilla (seeded random) y funciones hash como generadores deterministas de bajo costo de memoria.
- Funciones de ruido coherente (Perlin, Simplex, Value Noise, Worley) y sus parámetros de configuración.
- Funciones de suavizado e interpolación (lerp, smoothstep/sigmoid) aplicadas a la generación de ruido y terreno.
- Diagramas de Voronoi aplicados a la partición de territorios y mapas estilizados.
- Generación de mapas a partir de campos de ruido y manejo de memoria mediante chunks.
- Combinación de múltiples campos de ruido (temperatura, humedad, altura, pendiente) para la definición de biomas mediante reglas compuestas.
- Herramientas de autoría: generadores de mapas, autotiling y generación procedural de caminos.

## Unidad 2 — Falling sand

- El modelo de autómata celular aplicado a materiales granulares (arena, agua, fuego) con renderizado directo por píxel.
- Simulación en mundos de gran escala o infinitos mediante particionado del espacio.
- Integración con cuerpos rígidos (rigid bodies).
- Integración con campos de flujo (flow fields) para aproximar comportamiento fluido.

## Unidad 3 — Simulación de fluidos

- Enfoque basado en grilla / celdas (píxeles).
- Enfoque basado en partículas: fundamentos y motores de referencia (Liquid Fun).
- Smoothed Particle Hydrodynamics (SPH) y reconstrucción de superficie mediante marching squares.
- Método híbrido PIC/FLIP.
- Simulación de fluidos por campo de altura (height-field / 1.5D).

## Unidad 4 — Vida artificial y autómatas celulares

- Autómatas celulares clásicos: el Juego de la Vida y su formalización mediante convolución de kernels.
- Extensiones del modelo: vecindarios múltiples (Multiple Neighborhoods Cellular Automata).
- Transición al dominio continuo: SmoothLife.
- Modelos continuos de vida artificial: Lenia y Flow Lenia como generalización matemática de los autómatas celulares.
- Sistemas de partículas con reglas de interacción emergente: Particle Life y Particle Lenia.

## Unidad 5 — Optimización de simulaciones

- Análisis de complejidad algorítmica (notación Big O) aplicado a simulaciones.
- Organización de datos: Array of Structures vs. Structure of Arrays (SoA) y diseño orientado a datos (data-oriented design).
- Impacto del acceso a memoria: cache misses y comportamiento del garbage collector.
- El método científico aplicado a la optimización: formulación de una hipótesis de rendimiento (por ejemplo, "convertir esta estructura a SoA reduce el tiempo de frame"), diseño del experimento, medición mediante benchmarks y comparación cuantitativa entre una implementación baseline y la implementación modificada.
- Benchmarking comparativo (por ejemplo, el Juego de la Vida implementado con paradigma orientado a objetos versus SoA) como caso de aplicación del método anterior.
- Alternativas de ejecución de alto rendimiento en el navegador: WebAssembly.
- Caso de estudio de optimización sobre un proyecto propio de la cátedra (WeedJS).

## Unidad 6 — Ray casting

- Concepto de ray casting: proyección de un rayo y detección de la primera intersección con la escena.
- Resolución matemática de intersecciones rayo-superficie.
- Algoritmo DDA (Digital Differential Analyzer) sobre grillas, optimizado mediante spatial hashing.
- Aplicación histórica de referencia: el renderizado pseudo-3D de Wolfenstein 3D.
- Cálculo de iluminación mediante ray casting.

## Unidad 7 — Terreno destructible

- Representación híbrida grilla-malla (grid + mesh) para la deformación de terreno.
- Reconstrucción de contornos mediante marching squares.
- Enfoques alternativos basados en cuerpos rígidos compuestos, profundizados en la Unidad 10 (Box2D).
- Casos de referencia de la industria (Noita, Worms, Astroneer, A Game About Digging A Hole) como estudio de decisiones de diseño y de rendimiento.

- https://brotochola.github.io/destructible_terrain_2d/
-

## Unidad 8 — Simulación de sonido

- Fundamentos del audio digital: frecuencia de muestreo y profundidad de bits como discretización de una señal continua.
- Filtros digitales (pasa bajos, pasa altos, pasa banda).
- Espacialización sonora: sonido estéreo y sonido 3D.
- Procesamiento en tiempo real con Web Audio API (AudioContext, AudioWorklet) y automatización de parámetros.

## Unidad 9 — Simulación de eventos discretos y método Montecarlo

- Simulación de eventos discretos (DES): modelado de sistemas de colas (por ejemplo, cajas de un supermercado).
- Estructuras de datos de soporte: heap, min-heap, heapify, heap sort y sistemas de cola de eventos.
- Método Montecarlo como herramienta de experimentación estocástica.
- Caso de aplicación integrador: testeo de estrategias de blackjack mediante simulación estocástica repetida, como validación experimental de un modelo.

## Unidad 10 — Motores de física: cuerpos rígidos con Box2D

- Concepto de cuerpo rígido (rigid body) como unidad básica de un motor de físicas.
- Fundamentos de la física de Newton aplicados a la simulación: fuerzas, masa, velocidad angular.
- Métodos de integración numérica: dinámica basada en impulsos (impulse-based) frente a dinámica basada en posición (position-based), e integración de Verlet.
- Detección de colisiones: teorema del eje separador (SAT), volúmenes envolventes (AABB, OBB) y jerarquías de volúmenes envolventes (BVH).
- Dinámica angular: velocidad angular, angular drag, linear drag.
- Restricciones y articulaciones (constraints / joints): weld, distance, pin, mouse.
- Optimización del solver: coloreo de grafos de restricciones (graph coloring) y agrupamiento de cuerpos en reposo (islands).

Dinamica de la materia:
Los alumnos se dividirán en grupos de 2. A lo largo del cuatrimestre cada grupo deberá realizar un juego usando los contenidos y algoritmos de al menos 2 de las 10 unidades. Para la fecha de primer parcial deberán tener un GDD que explique en detalle qué tipo de proyecto van a llevar a cabo, cómo usarán los algoritmos dados en la materia...
Para la fecha de segundo parcial cada grupo deberá tener listo su proyecto: juego web, con url publica, que implemente al menos dos de las 10 unidades dadas en clase, con sentido y coherencia.

Al inicio del desarrollo de cada unidad temática, uno o dos grupos de estudiantes realizarán una breve exposición introductoria sobre los conceptos centrales del tema, en base a una investigación previa realizada por su cuenta, previo a que el/la docente desarrolle la unidad en profundidad. Los subtemas a desarrollar en dichas exposiciones son los siguientes:

- Pseudo random y Perlin noise.
- Mapa procedural.
- Falling sand.
- Simulación de agua con celdas.
- Simulación de agua con partículas.
- Cellular automata + kernel convolution + Game of Life.
- Particle Life + SmoothLife + Lenia.
- Big O + OOP vs SoA.
- Cache misses + Data Oriented Design + Garbage Collector.
- Ray casting: usos, ejemplos, por qué existe.
- Ray casting: algoritmo DDA.
- Terraforming: grilla + square/cube marching.
- Terraforming: Box2D (static vs dynamic, joints, quadtrees).
- Sonido digital: sampling rate, bit depth, compresión (mp3), ruido blanco.
- Sonido digital: Web Audio API + efectos (filtros, delay, pitch, etc.).
- Discrete event simulator.
- Montecarlo.
- SAT, OBB, AABB.
- Box2D.
