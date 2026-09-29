# Render queue y-sort: JS vs WASM, radix vs reinsert

## El problema

Entidades en SoA: `x: Float32Array`, `y: Float32Array`. Cámara = rectángulo
`[camX, camX+width] x [camY, camY+height]`. Cada frame hay que producir un
**render queue**: los ids de las entidades visibles (dentro del rectángulo),
ordenados ascendente por `y` (painter's algorithm / y-sort típico de juegos 2D).

Se comparan 4 estrategias:

- **radix JS / radix WASM**: cada frame, desde cero — construye claves
  `uint32` a partir de `y` (float) vía el truco de "float flip" de Michael
  Herf (preserva el orden de floats, incluyendo negativos, en un uint32) y
  corre un radix sort LSD de 4 pasadas de 8 bits, cargando el id como
  payload (key-value radix sort, no solo ordena los floats sueltos).
- **reinsert JS / reinsert WASM**: mantiene el orden del frame anterior,
  saca los ids que ya no son visibles, agrega al final los que entraron
  nuevos, y corre **insertion sort** sobre ese resultado. La apuesta es que
  como las entidades se mueven poco entre frames, el array queda "casi
  ordenado" y el insertion sort es ~O(n) en la práctica en vez de O(n log n).

Mismo layout de memoria para ambos engines (offsets calculados a partir de
`N`), memoria WASM compartida e importada (`shared:true`, `env.memory`),
igual que en el benchmark anterior — pero esta vez todo corre en el hilo
principal, sin workers: acá lo que se compara es el algoritmo, no el
hand-off entre threads, y sumar `postMessage`/`Atomics` solo agregaría
ruido a una medición que ya es de fracciones de milisegundo. Si lo llevás a
tu loop real en un worker, el mismo patrón de memoria compartida del
benchmark anterior aplica directo.

## Metodología

- Simulación de 200 frames, mundo de 20000x20000, cámara de 3000x2000
  paneando a velocidad fija (rebota en los bordes), cada entidad con una
  velocidad de deriva fija aleatoria (hasta 3 unidades/frame por eje).
- Los 4 métodos reciben, para cada frame, el **mismo** set de ids visibles
  (un cull compartido, hecho una sola vez por frame, no cronometrado — es
  idéntico para los 4 y no es lo que se está comparando).
- Se cronometra únicamente la construcción/actualización del queue
  ordenado (radix: flip+radix sort completo; reinsert: diff + insertion
  sort). Copiar los datos de posición a la memoria WASM también queda
  **fuera** del tiempo medido (es preparación de frame, no parte del sort).
- 200 frames por tamaño, se descartan los primeros 15 (warmup de JIT /
  cold-start del reinsert, que en el frame 0 no tiene orden previo) y se
  reporta la mediana de los 185 restantes.
- Cada frame se verifica: el resultado tiene el largo correcto, está
  ordenado ascendente por `y`, y el multiset de ids coincide con el
  esperado (checksum de suma + xor).

## Resultados (mediana ms/frame, este contenedor)

| N       | visible (avg) | radix JS | radix WASM | reinsert JS | reinsert WASM |
|---------|---------------|----------|------------|-------------|----------------|
| 10,000  | 157           | 0.0054   | 0.0025     | 0.0037      | 0.0015         |
| 50,000  | 756           | 0.0259   | 0.0097     | 0.0241      | 0.0085         |
| 100,000 | 1,520         | 0.0532   | 0.0202     | 0.0625      | 0.0261         |
| 200,000 | 3,012         | 0.1085   | 0.0372     | 0.1914      | 0.0844         |

`results.json` tiene todas las corridas crudas (no solo la mediana).

## El hallazgo importante: reinsert no siempre gana, y por qué

A 10k y 50k, reinsert le gana a radix (como se esperaría de un algoritmo
que explota datos casi ordenados). Pero a 100k y sobre todo a 200k, **se
invierte**: reinsert JS pasa a ser ~1.8x más lento que radix JS.

No es el churn (entidades que entran/salen de cámara por frame): eso se
mantiene en ~2.2% del set visible en los 4 tamaños, prácticamente
constante — no es lo que explica la reversión.

Es la **densidad**. Mundo y cámara son de tamaño fijo, así que al subir
`N` hay más entidades por unidad de área → los vecinos en `y` quedan cada
vez más pegados entre sí → una velocidad de entidad **fija** (3
unidades/frame) termina cruzando cada vez a más vecinos por frame.
Medido directamente (`density_experiment.mjs`, cuenta los pasos de shift
que hace el insertion sort, no tiempo de reloj):

| N       | shifts por entidad visible |
|---------|------------------------------|
| 10,000  | 0.50 |
| 50,000  | 2.40 |
| 100,000 | 4.90 |
| 200,000 | 9.78 |

Crece ~linealmente con `N` — es decir, el trabajo *total* del insertion
sort crece ~O(N²) en este escenario, mientras que radix se mantiene
O(N) (no le importa si los datos están cerca o lejos de su posición
final, siempre hace el mismo trabajo). La premisa "insertion sort es
rápido en datos casi ordenados" deja de cumplirse en cuanto la distancia
típica de desplazamiento por frame deja de ser chica **relativa al gap
típico entre vecinos**, y ese gap se achica solo con subir `N` a
mundo/cámara constantes.

**Implicancia práctica**: si tu densidad de entidades crece con el total
de entidades (mundo/cámara de tamaño fijo), el truco de reinsert se
degrada justo en el caso donde más lo necesitás (mucha entidades). Si en
cambio tu mundo/cámara escalan junto con `N` (densidad constante), o tus
entidades se mueven lento en relación a esa densidad, reinsert se
mantiene ganando en todos los tamaños — confirmado achicando la velocidad
de deriva 10x a N=200,000: el tiempo de reinsert JS baja de ~0.18ms a
~0.13ms mientras radix se mantiene ~0.11ms (todavía no cruza del todo en
esa prueba puntual, pero la brecha se cierra fuerte).

## WASM vs JS

Con memoria compartida, WASM le gana a JS de forma consistente en las 4
combinaciones y en todos los tamaños — entre 1.6x y 2.3x más rápido según
el caso. Tiene sentido: ambos algoritmos acá son casi puro acceso a
memoria (loads/stores de u32/f32, comparaciones, shifts), exactamente el
tipo de código donde el acceso predecible a memoria lineal de WASM le
saca ventaja a los bounds-checks/guards de V8, incluso sobre typed arrays.

## Archivos

- `assembly/renderqueue.ts` — radix sort (key-value, float-flip) + reinsert
  update, AssemblyScript, sobre memoria compartida e importada
- `build/renderqueue.wasm` — binario compilado
- `renderQueueAlgosJs.mjs` — mismos dos algoritmos en JS puro
- `simulate.mjs` — simulación determinística (posiciones, cámara, cull)
- `main.mjs` — harness principal: corre los 4 métodos sobre la misma
  secuencia de frames, mide, verifica, escribe `results.json`
- `density_experiment.mjs` — diagnóstico standalone: cuenta shifts de
  insertion sort por entidad visible, según N
- `results.json` — resultados crudos del último run de `main.mjs`

```bash
npm install     # assemblyscript, solo si querés recompilar el .ts
node main.mjs
node density_experiment.mjs
```
