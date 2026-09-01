# Simulación de fluidos 2D — guía de clase (3 horas)

Imaginen una hoja cuadriculada. En cada casilla podemos guardar “cuánta agua hay”, o bien podemos representar el agua como un montón de puntitos que se mueven. El problema de toda esta clase es el mismo:

**¿Cómo hacemos que el agua (o el humo, o la arena “líquida”) se mueva de forma creíble en una computadora?**

No hay una sola respuesta. Hay familias enteras de algoritmos. Esta guía las recorre **en orden de complejidad conceptual**, como las iría inventando un programador que empieza por lo más simple y va pidiendo más realismo.

Abrí siempre este archivo primero. Cada sección linkea a una demo (o a material de la clase anterior).

**Importante:** los HTML de esta carpeta son **demos didácticas**. Ilustran una idea; no son la definición canónica del método ni un sustituto del paper. Donde el texto diga "en esta demo…", léase como implementación de ejemplo.

**Demos online:** también están en GitHub Pages: [https://brotochola.github.io/Unahur_Simulacion_1/](https://brotochola.github.io/Unahur_Simulacion_1/). En cada sección, **Demo online** abre la página publicada; **Código** apunta al HTML del repo (relativo). Si una carpeta recién renombrada aún no está en `main` desplegado, el link Pages puede fallar hasta el próximo publish.

---

## Tres maneras de “mirar” el fluido

Antes de tocar código, conviene fijar el vocabulario. Van a aparecer una y otra vez.

**Euleriano (mirada fija en el espacio).**  
Fijamos una grilla en el mundo. Cada celda pregunta: “¿qué pasa *acá*?”. La masa y la velocidad viven en casillas; el fluido “pasa” por ellas. Es como sensores clavados en un río. Casi todos los juegos 2D de “agua en tiles” y el método de Stam son eulerianos.

**Lagrangiano (mirada que viaja con la materia).**  
Representamos el fluido con **partículas**. Cada partícula pregunta: “¿dónde estoy y a qué velocidad voy?”. No hay casilla dueña del agua: el agua *es* el conjunto de partículas. **SPH** (Smoothed Particle Hydrodynamics) es el ejemplo clásico.

**Híbrido.**  
Se usan **partículas y grilla a la vez**. Las partículas llevan masa e historia; la grilla sirve para calcular fuerzas/presión de forma eficiente. **PIC**, **FLIP** y **MPM** viven acá.

En esta clase el recorrido es:

1. Reglas discretas tipo **falling sand** (todavía no es “fluido continuo”).
2. Euleriano celular cada vez más sofisticado, hasta **Stam / Stable Fluids**.
3. Otra familia euleriana: **LBM** (Lattice Boltzmann).
4. Lagrangiano puro (**SPH**) e híbridos (**PIC/FLIP**, **MPM**).

---

## Glosario de siglas

Toda sigla de esta guía aparece acá. La primera vez que aparece en el texto también se explica en prosa.

| Sigla | Significado | En una frase |
| ----- | ----------- | ------------ |
| **CA** | Cellular Automaton (autómata celular) | Reglas locales sobre una grilla de celdas. |
| **CFD** | Computational Fluid Dynamics | Simulación numérica de fluidos en general. |
| **NS** | Navier–Stokes | Ecuaciones clásicas del fluido viscoso continuo. |
| **MAC** | Marker-And-Cell | Grilla donde la velocidad vive en las *caras* de la celda y la presión en el centro. |
| **LBM** | Lattice Boltzmann Method | El fluido se representa con “paquetes” de densidad que viajan en direcciones discretas de una red. |
| **BGK** | Bhatnagar–Gross–Krook | Modelo simple de colisión en LBM (relajación hacia un equilibrio). |
| **SPH** | Smoothed Particle Hydrodynamics | Partículas que estiman densidad/presión promediando vecinas con un kernel suave. |
| **PIC** | Particle-In-Cell | Partículas ↔ grilla: se esparce a la grilla, se resuelve ahí, se interpola de vuelta. |
| **FLIP** | FLuid-Implicit Particle | Variante de PIC que mezcla el *incremento* de velocidad de la grilla para menos difusión numérica. |
| **MPM** | Material Point Method | Híbrido partícula–grilla (familia cercana a PIC) muy usado en gráficos y sólidos/fluidos. |
| **MLS** | Moving Least Squares | Técnica de aproximación; en **MLS-MPM** mejora la transferencia partícula↔grilla. |
| **PVFS** | (en esta repo) demo externa tipo MPM/capas líquidas | Nombre de la demo 08; no es un acrónimo de curso estándar como SPH/MPM. |
| **FVM** | Finite Volume Method | Discretización por volúmenes de control (mencionado solo como contexto CFD). |
| **PDE** | Partial Differential Equation | Ecuación en derivadas parciales (NS es un sistema de PDEs). |

---

## Cronograma sugerido (3 horas ≈ 180 min)

| Bloque | Min | Qué hacer | Abrir |
| ------ | --- | --------- | ----- |
| 0. Marco | 0–15 | Euleriano vs lagrangiano vs híbrido; mapa de la clase | este `.md` |
| 1. Falling sand | 15–35 | Reglas discretas; qué *no* modela | [Código](../2%20-%20falling_sand/falling-sand.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/2%20-%20falling_sand/falling-sand.html) |
| 2. CA con volumen parcial | 35–55 | Fill continuo; presión hidrostática aproximada | [Código](./01-automata-celular-presion-por-columna-water-caves/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/01-automata-celular-presion-por-columna-water-caves/index.html) |
| 3. Fick + falling sand + flowfield | 55–80 | Exceso, difusión, campo auxiliar inercial | [Código](./02-fick-jacobi-falling-sand-flowfield-inercial/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/02-fick-jacobi-falling-sand-flowfield-inercial/index.html) |
| 4. Puente MAC | 80–100 | Flujos en caras + proyección parcial | [Código](./03-fick-en-caras-mac-flowfield-flechas-proyeccion-stam/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/03-fick-en-caras-mac-flowfield-flechas-proyeccion-stam/index.html) |
| 5. **Stam en profundidad** | 100–130 | Stable Fluids, proyección, `div v ≈ 0` | [Código](./04-stam-stable-fluids-grilla-mac-proyeccion-presion/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/04-stam-stable-fluids-grilla-mac-proyeccion-presion/index.html) |
| 6. LBM | 130–150 | Otra euleriana; dam break free-surface | [Código](./05-lattice-boltzmann-lbm-thurey/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/05-lattice-boltzmann-lbm-thurey/index.html) |
| 7. SPH → PIC/FLIP → MPM | 150–170 | Partículas y híbridos | [Código SPH](./SPHjs/index.html) · [Online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/SPHjs/index.html); [Código 06](./06-particulas-pic-flip-muller/index.html) · [Online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/06-particulas-pic-flip-muller/index.html); [Código 07](./07-mls-mpm-material-point-method/index.html) · [Online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/07-mls-mpm-material-point-method/index.html); [Código 08](./08-mpm-pvfs-demo-externa/index.html) · [Online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/08-mpm-pvfs-demo-externa/index.html) |
| 8. Cierre | 170–180 | Cuadro "cuándo usar qué" | este `.md` |

Si se atrasa el reloj: recortar LBM a 10 min y la demo 08 a “solo mirar 2 minutos”. El núcleo intocable es **falling sand → 01 → 02 → 03 → 04**.

---

## Mapa de demos (links rápidos)

| # | Demo | Familia | Links |
| - | ---- | ------- | ----- |
| — | Falling sand (clase 2) | Reglas discretas / precursor | [Código](../2%20-%20falling_sand/falling-sand.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/2%20-%20falling_sand/falling-sand.html) |
| 01 | Autómata celular · presión por columna | Euleriano (CA) | [Código](./01-automata-celular-presion-por-columna-water-caves/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/01-automata-celular-presion-por-columna-water-caves/index.html) |
| 02 | Fick–Jacobi · falling sand · flowfield | Euleriano (difusión + CA) | [Código](./02-fick-jacobi-falling-sand-flowfield-inercial/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/02-fick-jacobi-falling-sand-flowfield-inercial/index.html) |
| 03 | Fick en caras MAC · campo auxiliar · proyección | Euleriano (puente MAC) | [Código](./03-fick-en-caras-mac-flowfield-flechas-proyeccion-stam/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/03-fick-en-caras-mac-flowfield-flechas-proyeccion-stam/index.html) |
| 04 | Stam Stable Fluids · grilla MAC | Euleriano (NS simplificado) | [Código](./04-stam-stable-fluids-grilla-mac-proyeccion-presion/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/04-stam-stable-fluids-grilla-mac-proyeccion-presion/index.html) |
| 05 | Lattice Boltzmann (LBM) | Euleriano (red de Boltzmann) | [Código](./05-lattice-boltzmann-lbm-thurey/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/05-lattice-boltzmann-lbm-thurey/index.html) |
| — | SPH (SPHjs) | Lagrangiano | [Código](./SPHjs/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/SPHjs/index.html) |
| 06 | PIC/FLIP | Híbrido | [Código](./06-particulas-pic-flip-muller/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/06-particulas-pic-flip-muller/index.html) |
| 07 | MLS-MPM | Híbrido | [Código](./07-mls-mpm-material-point-method/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/07-mls-mpm-material-point-method/index.html) |
| 08 | MPM / PVFS (demo externa) | Híbrido (referencia visual) | [Código](./08-mpm-pvfs-demo-externa/index.html) · [Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/08-mpm-pvfs-demo-externa/index.html) |

---

# Acto I — Falling sand (todavía no es un fluido continuo)

[Demo online](https://brotochola.github.io/Unahur_Simulacion_1/2%20-%20falling_sand/falling-sand.html) · [Código](../2%20-%20falling_sand/falling-sand.html)

## Idea

Cada celda tiene un **tipo** (vacío, arena, agua, piedra…). En cada frame aplicamos reglas del estilo: “si abajo está vacío, caigo; si no, pruebo diagonales”. Es un **autómata celular** (**CA**): el próximo estado de una celda depende solo de ella y de sus vecinos.

Es el punto de partida perfecto porque:

- se programa en una tarde,
- se ve “materia que cae”,
- y deja clarísimo el costo de *no* modelar presión, incompresibilidad ni campo de velocidad continuo.

## Qué guarda el estado

En lo más crudo: un `grid[x][y] = materialId`. A veces un poco de “vida” o color. No hay `vx, vy` reales de fluido.

## Cómo avanza un frame

Barrido de celdas (a menudo de abajo hacia arriba para la gravedad) + reglas de intercambio con vecinos.

## Límites (por eso seguimos)

- El “agua” de falling sand no empuja como un líquido real: no hay chorros incompresibles, ni olas con inercia creíble, ni vaso comunicante físico.
- No hay campo de velocidad continuo: no podés preguntar “¿cuál es la velocidad en este punto del espacio?” de forma estable.
- Escalar a fenómenos de fluido (salpicaduras, vórtices) obliga a *cambiar de modelo*, no solo a retocar reglas.

**Lecturas:** [Cellular automaton (Wikipedia)](https://en.wikipedia.org/wiki/Cellular_automaton). Ejemplos populares de CA de materiales: *The Powder Toy*, *Noita* (contexto cultural, no papers).

En esta misma carpeta de la clase 2 hay variantes (`falling_sand_gravedad.html`, marching squares, etc.): sirven de laboratorio de reglas, no de CFD.

---

# Acto II — Euleriano: de autómatas celulares con volumen a Stable Fluids

Seguimos en representación **euleriana** (estado en una grilla fija). La progresión suma ingredientes del continuo: volumen parcial por celda, difusión, discretización **MAC**, y finalmente **proyección de presión** (incompresibilidad aproximada). Cada carpeta numerada es una demo que acerca ese salto; el método “de verdad” está en la bibliografía.

---

## 01 — Autómata celular con presión por columna

[Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/01-automata-celular-presion-por-columna-water-caves/index.html) · [Código](./01-automata-celular-presion-por-columna-water-caves/index.html)

### Idea

Seguimos en un **autómata celular** sobre grilla, pero el estado deja de ser solo un enum de material: cada celda guarda un **volumen parcial** (fill ∈ [0,1]) y una **presión heurística** aproximando la columna de fluido encima (idea tipo hidrostática `ρgh`, sin resolver Poisson).

Reglas locales típicas: transferencia vertical por gravedad; si el vecino inferior está saturado o es sólido, flujo horizontal según Δpresión; redistribución si `fill > 1`.

Es el salto natural desde falling sand: misma familia **CA**, estado más rico.

### Cómo se calcula el “fill” (altura / volumen en la celda)

En esta demo **no hay una variable `altura` aparte**. Lo que hace de altura local es `fillLevel` ∈ [0, 1+] (a veces > 1 un instante):

- `0` = celda vacía,
- `1` = celda “llena” (capacidad de una celda de grilla),
- valores intermedios = volumen parcial (se dibuja como nivel dentro del tile).

`WATER_CELL_SIZE = 1` es solo un factor de escala del puerto; con ese valor, el fill ya está normalizado a “fracción de celda”. La evolución de `fillLevel` no es una integral de altura libre: cambia por **transferencias** (abajo, laterales por Δpresión, desborde si `fillLevel > 1`, grifo/desagüe).

### Cómo se calcula la presión (en esta demo)

Cada subpaso, en celdas no sólidas (`water.js`, `Cell.step`):

1. **Base local (heurística tipo columna corta):**  
   `pressure ← (WATER_CELL_SIZE × fillLevel) / 5`  
   Con `WATER_CELL_SIZE = 1`: `pressure ← fillLevel / 5`.  
   No es `ρ g h` de un solver; es un escalado ad hoc del fill.

2. **Aporte de la columna (arriba):**  
   - Si el vecino superior existe y no es sólido: `pressure ← pressure + pressure_arriba` (se apila la presión ya calculada de arriba).  
   - Si arriba es sólido/techo: se busca a izquierda/derecha un “hueco” hacia una celda con agua arriba y se suma esa presión (continuidad bajo techo, también heurística).

3. **Suavizado lateral:** mezcla con vecinos izquierdo/derecho, p. ej.  
   `0.4·propia + 0.3·izq + 0.3·der` (o 50/50 si solo hay un lado).

4. **Clamp:** `pressure ← max(pressure, 0)`.

Esa `pressure` **no** mueve masa por sí sola en vertical (la caída es transferencia directa hacia abajo). Sirve sobre todo para el **flujo horizontal** cuando abajo está lleno o es sólido: se transfiere ~ `(Δpressure) × 200 × dt`, acotado por los fills.

Orden de actualización: el motor barre columnas alternando sentido (`tic-tac`) para reducir sesgo izquierda/derecha.

**Lectura del código:** [`water.js`](./01-automata-celular-presion-por-columna-water-caves/water.js) (`Cell.step`). Recordar: demo didáctica, no hidrostática de libro.

### Qué guarda cada celda (típico)

- `fillLevel` — cuánta agua hay
- `pressure` — heurística (columna + suavizado lateral)
- `flowX` / `flowY` — registro de transferencias (casi siempre para dibujar flechas)
- flags de sólido / grifo / desagüe

### Cómo avanza un frame

Varias subpasadas: recalcular presión → transferir hacia abajo → si no puede, flujo horizontal por Δpresión → desborde → fuentes/sumideros.

### Qué gana vs falling sand

Volumen parcial, equilibrado horizontal aproximado (vasos comunicantes *heurísticos*), superficie más legible que un CA de tipos discretos.

### Límites

La presión **no** sale de una ecuación de Poisson ni de Navier–Stokes. No hay campo de velocidad incompresible (`∇ · v = 0`). Sirve para gameplay/prototipo; no es CFD de ingeniería.

**No es:** Stable Fluids, LBM, SPH.

**Lecturas:** [Cellular automaton](https://en.wikipedia.org/wiki/Cellular_automaton) · [Hydrostatics](https://en.wikipedia.org/wiki/Hydrostatics) (solo como intuición de presión por columna; esta demo no integra hidrostática formal).

---

## 02 — Fick–Jacobi, falling sand y flowfield inercial

[Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/02-fick-jacobi-falling-sand-flowfield-inercial/index.html) · [Código](./02-fick-jacobi-falling-sand-flowfield-inercial/index.html)

### Idea

Cambiamos la metáfora de presión. Cada celda tiene una capacidad de **reposo** `N_reposo`. Si hay más masa que eso, el **exceso** `C = max(0, N − N_reposo)` se comporta un poco como gas comprimido: tiende a repartirse hacia vecinos con menos exceso.

Eso se implementa como **difusión de Fick** (flujo proporcional a la diferencia) con esquema **Jacobi**: se lee un buffer de masa y se escribe en otro (doble buffer), luego se intercambian. Así evitamos actualizar “en el lugar” y sesgar el barrido.

Separado, sigue habiendo un paso de **gravedad tipo falling sand**.

Además cada celda guarda un vector **flowfield** `V`: memoria inercial de “hacia dónde estuvo saliendo masa”. Ese `V` **sesga** el outflow de Fick. Ojo: acá “flowfield” **no** significa todavía el campo de velocidad incompresible de Stam.

### Qué guarda el estado

- masa `N` (y a veces tipo AIR/SOLID/WATER)
- `flowX`, `flowY` (el flowfield inercial)
- en la versión studio: chunks, path CPU/GPU

### Cómo avanza un substep (simplificado)

1. Fick/Jacobi: calcular outflows por exceso, escalar si hace falta para no bajar bajo reposo, swap de buffers.
2. Falling sand: mover masa hacia abajo / diagonales / laterales.
3. Actualizar `V` hacia la dirección del flujo real; opcional snap a cero si es muy chico.

### Qué gana vs 01

- Conservación de masa más explícita en el paso de difusión.
- Presión = exceso sobre reposo (útil para vasos en U sin usar `ρgh` literales).
- Una noción de **inercia direccional** (el flowfield).

### Límites

Sigue sin proyección incompresible. Los chorros “de verdad” (salpicadura con `div ≈ 0`) aparecen recién en Stam.

**Lecturas:** [Fick's laws of diffusion](https://en.wikipedia.org/wiki/Fick%27s_laws_of_diffusion) · [Jacobi method](https://en.wikipedia.org/wiki/Jacobi_method) · antecedente visual en [`_refs/ca-masa-conservada.html`](./_refs/ca-masa-conservada.html).

---

## 03 — Fick en caras MAC, flechas y proyección Stam liviana

[Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/03-fick-en-caras-mac-flowfield-flechas-proyeccion-stam/index.html) · [Código](./03-fick-en-caras-mac-flowfield-flechas-proyeccion-stam/index.html)

### Idea

Esta demo es un **puente pedagógico** entre el CA con volumen (01–02) y Stable Fluids (04). Introduce la grilla **MAC** (Marker-And-Cell):

- en cada **cara** entre celdas hay un flujo / empuje (analogía útil: “flujo por la arista”);
- en el **centro** de la celda vive la cantidad de masa.

El transporte de masa puede hacerse por diferencia de fill en las caras (Fick en aristas). Además se mantiene un campo auxiliar en celdas (visualizado como flechas), suavizado y con fricción, que también puede desplazar masa. Opcionalmente se aplica una **proyección de presión** (estilo Stam, pocas iteraciones) sobre los flujos de cara para reducir `∇ · v`.

Importante: acá la proyección corrige empujes; el transporte **no** es aún la advección semi-Lagrangiana completa del paper de Stam. Es una demo intermedia, no el método canónico.

### Sigla nueva: MAC

**MAC** = Marker-And-Cell (Harlow & Welch, 1965): velocidad en caras, presión (y escalares) en centros. Facilita medir la **divergencia** celda a celda (balance de flujo entrante/saliente).

### Qué gana vs 02

- Separación cara / centro (vocabulario estándar de CFD en grilla).
- Primera aparición de **proyección** en el sentido de métodos de proyección para flujo incompresible.
- Experimentos controlados: flujo por caras vs campo auxiliar en celdas.

### Límites

Híbrido didáctico: no es el pipeline Stable Fluids completo ni un solver MAC de producción.

**Lecturas:** [Marker-and-cell method](https://en.wikipedia.org/wiki/Marker-and-cell_method) · paper clásico: Harlow & Welch, *Numerical Calculation of Time-Dependent Viscous Incompressible Flow*, 1965.

---

## 04 — Stable Fluids (Stam) en grilla MAC — núcleo de la clase

[Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/04-stam-stable-fluids-grilla-mac-proyeccion-presion/index.html) · [Código](./04-stam-stable-fluids-grilla-mac-proyeccion-presion/index.html)

Esta sección es más larga a propósito. Si un programador se lleva **una** idea de las 3 horas, que sea esta.

### ¿Quién es Stam y qué problema resolvió?

**Jos Stam** publicó en SIGGRAPH 1999 el paper [*Stable Fluids*](https://doi.org/10.1145/311535.311548) ([PDF en la página del autor / mirrors académicos](https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/GDC03.pdf) — hay también la charla GDC “Real-Time Fluid Dynamics for Games”).

El problema práctico: integrar las ecuaciones de fluido (familia **Navier–Stokes**, **NS**) en tiempo real sin que la simulación **explote** cuando el paso de tiempo es grande. Los esquemas explícitos clásicos obligan a pasos chiquitos (condición tipo CFL). Stam popularizó un pipeline **incondicionalmente estable** para gráficos usando:

1. advección **semi-Lagrangiana** (backtrace),
2. y una **proyección** que fuerza el campo de velocidad a ser (casi) **incompresible**.

No pretende ser el CFD de ingeniería más preciso del mundo: pretende ser **estable, rápido y creíble en pantalla**.

### Navier–Stokes (forma reducida)

Para un fluido incompresible viscoso, la velocidad `v` y la presión `p` cumplen, en esencia:

- transporte + viscosidad + fuerzas + gradiente de presión = evolución de la velocidad,
- más la restricción **`∇ · v = 0`** (divergencia nula: el flujo es solenoidal; el volumen de fluido se conserva localmente).

Stam, en la práctica de juegos/demos, suele:

- aplicar fuerzas (gravedad, mouse),
- (a veces) difundir velocidad/viscosidad,
- advectar,
- **proyectar** para restaurar `∇ · v ≈ 0`.

### Grilla MAC en este demo

- `u` en caras verticales (flujo horizontal entre celdas vecinas en X),
- `v` en caras horizontales (flujo vertical),
- presión `p` (y a menudo la densidad/masa de tinta o agua) en centros.

Así, la divergencia de una celda se calcula sumando flujos de sus cuatro caras: es el corazón de la proyección.

### Pipeline de un tick (el orden importa)

1. **Fuerzas** — por ejemplo sumar gravedad a las caras con fluido. Acá “nace” la caída.
2. **Advección de velocidad (semi-Lagrangiana)** — para cada cara, *mirar hacia atrás* a lo largo de la velocidad (`x − v Δt`), interpolar bilinealmente el valor viejo, y traerlo. Intuición: “esta cara pregunta de dónde vino el fluido que ahora está acá”.  
   Por qué es estable: no empujás valores hacia adelante de forma explícita que se salgan de control; **muestreás** el campo pasado. El precio es difusión numérica (se borronean detalles) y, en cantidad, posible deriva de masa.
3. **Proyección (presión)** — calcular la divergencia del campo; resolver una ecuación de **Poisson** para la presión (`∇² p = ∇ · v / Δt` en la forma discreta típica); restar el gradiente de presión a la velocidad: `v ← v − Δt ∇p`.  
   Intuición geométrica (descomposición de Helmholtz–Hodge): un campo vectorial se descompone en una parte **solenoidal** (`∇ · v = 0`) más un **gradiente**. La proyección **sustrae** la componente irrotacional asociada a la compresión/expansión y retiene la parte compatible con incompresibilidad.
4. **Advección de masa / densidad** — con el `v` ya proyectado, transportás el color, el humo o la cantidad de agua.

En la demo de esta carpeta el pipeline es configurable (podés reordenar/apagar pasos) y suele mostrar `divMax`: si la proyección funciona, ese número baja.

### La ecuación de Poisson de la presión (y cómo se “resuelve”)

En la proyección aparece una **ecuación de Poisson** para la presión. En continuo, Poisson tiene la forma genérica

\[
\nabla^2 p = f
\]

donde \(\nabla^2\) (laplaciano) mide “cuánto se curva” un campo escalar, y \(f\) es un dato conocido. En Stable Fluids, \(f\) se construye a partir de la **divergencia** del campo de velocidad *antes* de proyectar: en la forma discreta habitual algo como \(\nabla^2 p = (\nabla \cdot v)/\Delta t\).

**Qué significa “resolverla”:** no es una fórmula cerrada tipo \(p = \ldots\) que evalúas una vez. Tras discretizar en la grilla, obtenés un **sistema lineal grande** \(A\mathbf{p} = \mathbf{b}\): una incógnita de presión por celda (o por nodo), acoplada a las vecinas porque el laplaciano mira diferencias con los vecinos. “Resolver Poisson” = encontrar ese campo \(p\) (aproximado) que hace consistente la corrección \(v \leftarrow v - \Delta t\,\nabla p\) con \(\nabla \cdot v \approx 0\).

Métodos iterativos clásicos (no invierten \(A\) de golpe):

- **Jacobi:** en cada iteración, **todas** las celdas actualizan su \(p\) usando solo valores de la iteración *anterior* (doble buffer). Simple de entender y de paralelizar; converge despacio.
- **Gauss–Seidel:** igual idea local (promedio/correción con vecinos), pero usa **de inmediato** los valores ya actualizados en la misma pasada. Suele converger más rápido que Jacobi con el mismo trabajo por celda; el orden del barrido importa y paralelizar es más delicado.
- En motores más serios aparecen también **gradiente conjugado**, multigrid, etc.: misma ecuación, menos iteraciones para el mismo error.

En tiempo real casi nunca se itera hasta convergencia matemática. Se hacen **pocas** pasadas Jacobi/Gauss–Seidel: más iteraciones ⇒ \(\nabla \cdot v\) más chico (mejor incompresibilidad aparente) ⇒ más CPU. Ese trade-off se discute en clase mirando `divMax` (o el header de la demo).

**Lecturas cortas:** [Poisson equation](https://en.wikipedia.org/wiki/Poisson_equation) · [Jacobi method](https://en.wikipedia.org/wiki/Jacobi_method) · [Gauss–Seidel method](https://en.wikipedia.org/wiki/Gauss%E2%80%93Seidel_method).

### Qué es el “flowfield” acá

Acá sí: el flowfield **es** el campo de velocidad MAC. Las flechas verdes suelen ser el promedio de las 4 caras (velocidad centrada) solo para visualizar.

### Qué gana vs 01–03

- Chorros, remolinos y salpicaduras con aspecto de líquido incompresible.
- Un modelo mental transferable a motores eulerianos en tiempo real (humo, agua estilizada, campos de densidad advectados).

### Límites honestos

- Advección semi-Lagrangiana **difunde** y no conserva masa exacta (por eso a veces se renormaliza).
- Condiciones de borde y superficie libre son delicadas.
- No es SPH ni un solver industrial de NS con todos los términos y turbulencia modelada.
- Viscosidad real vs difusión numérica: a menudo el “look” viscoso viene más del esquema que de un parámetro físico limpio.

### Lecturas (Stam y NS)

- Paper: Jos Stam, **Stable Fluids**, SIGGRAPH 1999 — [DOI 10.1145/311535.311548](https://doi.org/10.1145/311535.311548)
- Charla/notas: [Real-Time Fluid Dynamics for Games (GDC)](https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/GDC03.pdf)
- Contexto: [Navier–Stokes equations](https://en.wikipedia.org/wiki/Navier%E2%80%93Stokes_equations) · [Incompressible flow](https://en.wikipedia.org/wiki/Incompressible_flow) · [Semi-Lagrangian scheme](https://en.wikipedia.org/wiki/Semi-Lagrangian_scheme) · [Projection method (CFD)](https://en.wikipedia.org/wiki/Projection_method_(fluid_dynamics%29)

---

# Acto II-b — Otra familia euleriana: Lattice Boltzmann (LBM)

[Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/05-lattice-boltzmann-lbm-thurey/index.html) · [Código](./05-lattice-boltzmann-lbm-thurey/index.html)

## Idea

En **LBM** (Lattice Boltzmann Method) no guardamos solo “masa + velocidad” como en Stam. En cada nodo de una red hay **distribuciones** `f_i`: “cuánto ‘fluido probabilístico’ viaja en la dirección discreta `i`” (por ejemplo 9 direcciones en 2D: modelo D2Q9).

Un paso típico:

1. **Colisión** — las `f_i` se relajan hacia un equilibrio local (modelo **BGK** u otros).
2. **Streaming** — cada `f_i` salta al vecino en su dirección.

Después se reconstruyen densidad y velocidad sumando momentos de las `f_i`. Con la matemática adecuada, LBM **aproxima Navier–Stokes**.

## ¿LBM es “agua vista desde arriba” o “gases”?

**No es “principalmente vista desde arriba”.** Esa es una confusión frecuente.

- **LBM es un método general de CFD**: se usa para gases, líquidos, flujos en poros, aerodinámica simplificada, etc.
- Lo que cambia es *qué física extra* le agregás:
  - humo/gas en un canal,
  - flujo interno,
  - **superficie libre** (agua con aire) tipo **dam break**.

La demo de esta carpeta sigue la línea de **free-surface LBM** asociada a trabajo de **Nils Thürey** y colaboradores: típico **corte lateral** de un tanque que se rompe (pared que suelta agua), no un mapa top-down de ríos.

La simulación de agua “vista desde arriba” suele ser otra familia (**shallow water equations**, water heightfields, etc.), que puede implementarse con varios solvers; no hay que mezclarla con “LBM = cenital”.

## Qué gana vs Stam (y qué no)

- Muy paralelizable (colisión local + stream).
- Buena para ciertas fronteras y fenómenos multi-fase con extensiones.
- Otro set de knobs (relajación, velocidades de red); el debugging mental es distinto al de proyección Poisson.

No reemplaza a Stam en pedagogía: son dos discretizaciones distintas del mundo euleriano.

**Lecturas:** [Lattice Boltzmann methods](https://en.wikipedia.org/wiki/Lattice_Boltzmann_methods) · introducción clásica en libros de Succi · free-surface: trabajos de Thürey / Pohl / Rüde (buscar “Free Surface Lattice-Boltzmann”).

---

# Acto III — Lagrangiano: el fluido son partículas

Hasta acá, el espacio tenía dueño (la grilla). Ahora la materia tiene dueño (las partículas).

---

## SPH — Smoothed Particle Hydrodynamics (SPHjs)

[Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/SPHjs/index.html) · [Código](./SPHjs/index.html)

### Idea

**SPH** = Smoothed Particle Hydrodynamics. Cada partícula lleva masa, posición y velocidad. Para saber la densidad en un punto, **promediás partículas vecinas** con un **kernel** suave (una campana: cerca pesa más, lejos pesa menos). De la densidad se obtiene presión; de la presión, fuerzas; luego integrás movimiento (leapfrog / semi-implícito, etc.).

Analogía: cada partícula pregunta a sus vecinas “¿estoy muy apretada?” y se empujan.

### Qué gana

- Superficie libre natural (donde no hay partículas, no hay fluido).
- Salpicaduras y gotas emergen de forma natural (la superficie libre es el borde del soporte de partículas).
- Intuición lagrangiana clara para programadores.

### Límites

- Vecinos: necesitás búsqueda espacial (grilla de hash, árbol).
- Compresibilidad artificial / choice de ecuación de estado.
- Condiciones de borde más engorrosas que un MAC bien hecho.
- Costo crece con el número de partículas y el radio de kernel.

**Lecturas:** [Smoothed-particle hydrodynamics](https://en.wikipedia.org/wiki/Smoothed-particle_hydrodynamics) · papers fundacionales: Gingold & Monaghan 1977; Lucy 1977.

---

## 06 — PIC / FLIP (partículas + grilla)

[Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/06-particulas-pic-flip-muller/index.html) · [Código](./06-particulas-pic-flip-muller/index.html)

### Idea

**PIC** (Particle-In-Cell) y **FLIP** (FLuid-Implicit Particle) son **híbridos**: las partículas llevan la información, pero las fuerzas difíciles (presión / incompresibilidad) se resuelven en una grilla.

Pipeline típico:

1. Transferir masa/velocidad de partículas → grilla (**P2G**, particle-to-grid).
2. En la grilla: fuerzas, proyección de presión (como en Stam), etc.
3. Devolver velocidad a partículas (**G2P**).
   - **PIC** puro: la partícula *adopta* la velocidad interpolada de la grilla → estable pero difusivo (se “borra” el detalle).
   - **FLIP**: la partícula suma el *cambio* de velocidad de la grilla → conserva mejor vórtices y detalle; puede ser más ruidoso.
   - En la práctica se mezcla PIC/FLIP con un factor.

La demo de **Matthias Müller** (*Ten Minute Physics*) es un gran contraste visual después de 01–04: misma meta (agua), otra representación.

### Qué gana vs SPH puro

- Presión/incompresibilidad con herramientas eulerianas (Poisson en grilla).
- Suele ser más estable en “líquidos grandes” de gráficos.

### Qué gana vs Stam puro

- Mejor advección de interfaz y menos difusión de detalles que semi-Lagrangiana pura sobre una densidad.

**Lecturas:** [Particle-in-cell](https://en.wikipedia.org/wiki/Particle-in-cell) · FLIP en gráficos: Zhu & Bridson, *Animating Sand as a Fluid*, SIGGRAPH 2005 · curso/demos de Müller.

---

# Acto IV — Híbridos modernos: MPM

## 07 — MLS-MPM (Material Point Method)

[Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/07-mls-mpm-material-point-method/index.html) · [Código](./07-mls-mpm-material-point-method/index.html)

**MPM** (Material Point Method) también combina puntos de materia + grilla de fondo. Históricamente viene de mecánica de sólidos/continuum; en gráficos explotó para nieve, arena, líquidos, etc.

**MLS-MPM** usa **Moving Least Squares** (**MLS**) para mejorar la transferencia y el cálculo de deformación/fuerzas respecto de MPM ingenuo.

Ciclo mental (parecido a PIC, con acento en tensores de deformación / modelo constitutivo según el material):

1. Partículas → grilla  
2. Actualizar momento en grilla  
3. Grilla → partículas (y actualizar estado interno)

### Qué gana

- Un mismo framework puede hacer fluido *y* sólido blando cambiando el modelo de material.
- Muy usado en investigación de gráficos contemporánea.

**Lecturas:** [Material point method](https://en.wikipedia.org/wiki/Material_point_method) · Sulsky et al. (MPM clásico) · Hu et al., *MLS-MPM* (SIGGRAPH / papers de APIC/MLS-MPM).

---

## 08 — MPM / PVFS (demo externa, referencia visual)

[Demo online](https://brotochola.github.io/Unahur_Simulacion_1/3%20-%20simulacion%20de%20fluidos/08-mpm-pvfs-demo-externa/index.html) · [Código](./08-mpm-pvfs-demo-externa/index.html)

Demo pulida de capas líquidas interactivas (build externo). En clase: **2–5 minutos** para mostrar el techo visual de un solver híbrido moderno en el navegador, no para leer el código línea a línea.

El nombre de carpeta habla de MPM/PVFS como rótulo de la demo; el concepto a retener es: **híbrido partícula–grilla de producción**.

---

# Cuadro comparativo (todos los métodos del hilo)

| Método | Representación | Presión / incompresibilidad | Transporte de masa | ¿Cuándo tiene sentido? |
| ------ | -------------- | --------------------------- | ------------------ | ---------------------- |
| Falling sand | Grilla de tipos | No | Reglas de intercambio | Gameplay de arena/polvo; enseñar CA |
| 01 CA + volumen parcial | Grilla + fill | Heurística tipo columna (`ρgh` aproximado) | Transferencias locales | Prototipos 2D con fill continuo |
| 02 Fick + flowfield | Grilla + exceso | Exceso sobre reposo | Fick + falling sand | Conservación + presión por exceso |
| 03 MAC (puente) | Centros + caras | Proyección parcial (pocas iteraciones) | Flujos en caras + campo auxiliar | Introducir MAC y proyección |
| 04 Stam MAC | Velocidad en caras | Poisson → `div v ≈ 0` | Advección semi-Lagrangiana | Humo/líquido incompresible en tiempo real |
| 05 LBM | Distribuciones `f_i` | Emergente del esquema (+ free-surface) | Stream + collide | CFD paralelo; dam break free-surface |
| SPH | Partículas | Ecuación de estado / densidad kernel | Movimiento de partículas | Gotas, salpicaduras, superficie libre |
| 06 PIC/FLIP | Partículas + grilla | Proyección en grilla | Advección por partículas | Líquidos de gráficos con detalle |
| 07–08 MPM | Partículas + grilla | Según modelo / proyección | P2G / G2P | Fluidos y sólidos en un framework |

Mensaje unificador:

> Primero elegís **quién lleva el estado** (celda, partícula, o ambos). Después elegís **cómo imponés presión / volumen**. Ahí se juega casi toda la diferencia visual.

Ojo con la palabra **flowfield**: en 02/03 es memoria o flecha auxiliar; en 04 es la velocidad del fluido.

---

## Si programás X, empezá por Y

| Querés… | Empezá por… |
| ------- | ----------- |
| Entender grillas y reglas | Falling sand → 01 |
| Conservación y “presión por exceso” | 02 |
| Entender caras MAC y divergencia | 03 luego 04 |
| Humo/líquido incompresible en tiempo real | **04 Stam** (leer el paper) |
| Dam break / otra discretización euleriana | 05 LBM |
| Gotas y superficie libre sin tracking explícito | SPH (SPHjs) |
| Líquido con detalle y proyección seria | 06 PIC/FLIP |
| Framework unificado fluido/sólido | 07 MPM |

---

## Bibliografía rápida (Wikipedia + papers)

### Wikipedia (conceptos)

- [Cellular automaton](https://en.wikipedia.org/wiki/Cellular_automaton)
- [Fick's laws of diffusion](https://en.wikipedia.org/wiki/Fick%27s_laws_of_diffusion)
- [Jacobi method](https://en.wikipedia.org/wiki/Jacobi_method)
- [Marker-and-cell method](https://en.wikipedia.org/wiki/Marker-and-cell_method)
- [Navier–Stokes equations](https://en.wikipedia.org/wiki/Navier%E2%80%93Stokes_equations)
- [Incompressible flow](https://en.wikipedia.org/wiki/Incompressible_flow)
- [Projection method (fluid dynamics)](https://en.wikipedia.org/wiki/Projection_method_(fluid_dynamics%29)
- [Semi-Lagrangian scheme](https://en.wikipedia.org/wiki/Semi-Lagrangian_scheme)
- [Lattice Boltzmann methods](https://en.wikipedia.org/wiki/Lattice_Boltzmann_methods)
- [Smoothed-particle hydrodynamics](https://en.wikipedia.org/wiki/Smoothed-particle_hydrodynamics)
- [Particle-in-cell](https://en.wikipedia.org/wiki/Particle-in-cell)
- [Material point method](https://en.wikipedia.org/wiki/Material_point_method)
- [Computational fluid dynamics](https://en.wikipedia.org/wiki/Computational_fluid_dynamics)

### Papers / fuentes canónicas

- Harlow & Welch (1965) — Marker-and-Cell / flujos viscosos incompresibles.
- Jos Stam (1999) — **Stable Fluids**, SIGGRAPH — [DOI](https://doi.org/10.1145/311535.311548) · [PDF GDC notes](https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/GDC03.pdf)
- Gingold & Monaghan (1977); Lucy (1977) — SPH.
- Zhu & Bridson (2005) — FLIP para arena/fluidos en gráficos.
- Sulsky et al. — MPM clásico; Hu et al. — MLS-MPM.
- Thürey et al. — free-surface Lattice Boltzmann (dam break / liquids).

### En esta carpeta (`_refs/`)

- [CA de masa conservada](./_refs/ca-masa-conservada.html) — antecedente visual del enfoque “reposo / exceso”.
- [Inside LiquidFun (PDF)](./_refs/Inside%20LiquidFun.pdf) — motor de líquidos 2D de producción (Box2D/LiquidFun).

### Hermanas en el directorio (no numeradas)

- [`SPHjs/`](./SPHjs/index.html) — ya integrada al Acto III.
- [`mls mpm vs sph/`](./mls%20mpm%20vs%20sph/index.html) — contraste visual extra MPM vs SPH si sobra tiempo.
- [`water-caves-simulator-2d/`](./water-caves-simulator-2d/) — implementación afín al CA con volumen parcial (demo 01).

---

## Síntesis

1. **Falling sand** — autómatas celulares de materiales sobre grilla.  
2. **01–02** — volumen/masa continua por celda y modelos de presión *heurísticos* (columna o exceso).  
3. **03–04** — grilla MAC, divergencia y métodos de proyección; Stable Fluids (advect + project).  
4. **LBM** — otra discretización euleriana (no “Stam con otro nombre”).  
5. **SPH → PIC/FLIP → MPM** — eje lagrangiano/híbrido cuando la superficie libre y el detalle material pesan más que una sola grilla de celdas.

Pregunta guía al cerrar: *¿quién almacena el estado del fluido y cómo se impone (o no) la incompresibilidad?* Si eso se puede responder para cada demo, el hilo de la clase cerró bien.

Recordatorio final: estas demos **ilustran**; la referencia normativa es la bibliografía.
