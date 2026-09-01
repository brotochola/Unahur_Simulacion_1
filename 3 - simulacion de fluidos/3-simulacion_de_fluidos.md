# Simulación de fluidos 2D — hilo de la clase

Imaginen una hoja cuadriculada. En cada casilla guardamos “cuánta agua hay” (y a veces una flecha que dice hacia dónde empuja). El problema de toda esta clase es el mismo:

**¿Cómo hacemos que esa agua se mueva de casilla en casilla de forma creíble?**

No hay una sola respuesta. Abajo hay ocho demos. Las cuatro primeras se parecen por fuera (pintás agua, hay paredes, cae con gravedad) pero **adentro usan motores distintos**. Las cuatro siguientes muestran otras familias: Lattice Boltzmann, partículas PIC/FLIP y Material Point Method.

Abrí siempre este archivo primero. Cada sección linkea a su demo.

---

## Mapa de la clase

| # | Carpeta / demo | Idea en una línea |
|---|----------------|-------------------|
| 01 | [Autómata celular · presión por columna](./01-automata-celular-presion-por-columna-water-caves/index.html) | Reglas locales tipo juego: cae, empuja al costado, desborda |
| 02 | [Fick–Jacobi · falling sand · flowfield](./02-fick-jacobi-falling-sand-flowfield-inercial/index.html) | El “exceso” sobre el reposo se difunde; una V recuerda el movimiento |
| 03 | [Fick en caras MAC · flechas · Stam light](./03-fick-en-caras-mac-flowfield-flechas-proyeccion-stam/index.html) | Mangueras entre casillas + flechas; proyección opcional |
| 04 | [Stam Stable Fluids · grilla MAC](./04-stam-stable-fluids-grilla-mac-proyeccion-presion/index.html) | Velocidad en caras + presión que fuerza `div v ≈ 0` |
| 05 | [Lattice Boltzmann (LBM)](./05-lattice-boltzmann-lbm-thurey/index.html) | Distribuciones en direcciones de red; dam break |
| 06 | [PIC/FLIP (partículas)](./06-particulas-pic-flip-muller/index.html) | Partículas llevan masa/velocidad; la grilla resuelve presión |
| 07 | [MLS-MPM](./07-mls-mpm-material-point-method/index.html) | Puntos de materia ↔ grilla (híbrido partículas/campo) |
| 08 | [MPM / PVFS (demo externa)](./08-mpm-pvfs-demo-externa/index.html) | Demo pulida de capas líquidas (referencia visual) |

**Núcleo del contraste (imprescindible):** 01 → 02 → 03 → 04.  
**Si sobra tiempo:** 05–08.

---

## 01 — Autómata celular con presión por columna

[Abrir demo](./01-automata-celular-presion-por-columna-water-caves/index.html)

Pensá un videojuego de cuevas: el agua “quiere” caer, llenar huecos y nivelarse. No resolvemos las ecuaciones del continuo; aplicamos **reglas locales** celda por celda.

Cada celda guarda, entre otras cosas:

- `fillLevel` — cuánta agua hay (típicamente 0–1)
- `pressure` — una presión improvisada a partir del llenado y de lo que hay arriba (como apilar vasos)
- `flowX` / `flowY` — registro de lo que se movió (sirve sobre todo para dibujar flechas)

En cada subpaso la celda suele: calcular presión (incluyendo herencia de la columna), suavizar un poco con vecinos laterales, **transferir hacia abajo** si puede, y si abajo está lleno o es pared, **empujar horizontalmente** según diferencia de presión. Si se pasa de 1, **desborda** hacia arriba/lados.

Nombre informal: autómata de volumen al estilo *water-caves-simulator-2d*.  
**No es** un solver incompresible, ni Stam, ni LBM. La “presión” es una heurística para que el agua baje y se nivele de forma barata y estable.

---

## 02 — Fick–Jacobi, falling sand y flowfield inercial

[Abrir demo](./02-fick-jacobi-falling-sand-flowfield-inercial/index.html)

Acá la metáfora cambia. Cada celda tiene una capacidad de **reposo** (`N_reposo`). Si hay más agua que eso, el **exceso** se comporta un poco como gas comprimido: empuja hacia vecinos con menos exceso. Eso se implementa como **difusión de Fick** con esquema **Jacobi** (doble buffer: se lee un mapa de masa y se escribe en otro, luego se intercambian).

Separado de eso, hay un paso de **gravedad tipo falling sand** (prioridad: abajo, diagonales, laterales).

Además cada celda guarda un vector **flowfield** `V`: se actualiza por inercia (`lerp` hacia la dirección en la que realmente salió masa) y, a su vez, **sesga** el outflow de Fick. No es la velocidad de un fluido incompresible; es memoria direccional del flujo celular.

Resumen técnico: fluido celular con conservación de masa por transferencias escaladas, presión = `max(0, N − N_reposo)` (no `ρgh`), path CPU y GPU (WebGL2).  
**No es** Navier–Stokes / Stam / SPH / LBM clásico.

Detalle útil en clase: cargá el vaso en U y mirá cómo el exceso, no la altura sola, empuja el equilibrio.

---

## 03 — Fick en caras MAC, flechas (flowfield) y proyección Stam liviana

[Abrir demo](./03-fick-en-caras-mac-flowfield-flechas-proyeccion-stam/index.html)

Este laboratorio es el **puente** entre el mundo celular (01–02) y Stam (04).

Imaginen que entre dos casillas vecinas hay una **manguera** (una cara de la grilla MAC). Si una casilla tiene más agua que la otra, la manguera siente un **empuje**; ese empuje puede **pasar masa** (Fick / intercambio en aristas). Al mismo tiempo, cada casilla arma una **flecha** mirando sus mangueras: esa flecha se suaviza, tiene fricción y también puede arrastrar agua (a menudo con un raycast multicelda).

Opcionalmente se corre una **proyección de presión estilo Stam** sobre los empujes de las mangueras para bajar la divergencia y mejorar curls. Esa proyección **no reemplaza** el transporte de masa: la masa sigue viajando por mangueras/flechas, no por advección bilineal completa como en el 04.

Sirve para jugar con knobs: “¿quién mueve el agua, la manguera o la flecha?” y “¿qué cambia al prender la proyección?”.

---

## 04 — Stable Fluids (Stam) en grilla MAC

[Abrir demo](./04-stam-stable-fluids-grilla-mac-proyeccion-presion/index.html)

Acá sí estamos cerca del paper clásico de **Jos Stam — Stable Fluids**. La velocidad vive en las **caras** de la grilla (MAC: `u` en caras verticales, `v` en horizontales); la presión vive en los **centros**.

Pipeline típico de un tick:

1. **Fuerzas** (gravedad sobre las caras)
2. **Advección de velocidad** (semi-Lagrangiana: backtrace + interpolación bilineal)
3. **Proyección** — se resuelve una presión (Jacobi sobre Poisson) para que lo que entra a una celda sea ≈ lo que sale (`div v ≈ 0`): agua **incompresible**
4. **Advección de masa** con el campo ya proyectado

El “flowfield” acá **es** el campo de velocidad. Por eso aparecen chorros y salpicaduras más creíbles que en los autómatas. La advección semi-Lagrangiana no conserva masa exacta; la demo puede renormalizar (knob didáctico). Miren `divMax` en el header: baja cuando la proyección hace bien su trabajo.

---

## 05 — Lattice Boltzmann (LBM)

[Abrir demo](./05-lattice-boltzmann-lbm-thurey/index.html)

En LBM no guardamos solo “masa + una flecha”. En cada nodo de la red hay **distribuciones** que viajan en un conjunto discreto de direcciones. Un paso típico: **streaming** (las distribuciones saltan al vecino) y **colisión** (se relajan hacia un equilibrio local). De ahí se reconstruyen densidad y velocidad.

Esta demo (línea Thürey / free-surface) muestra un **dam break**: pared que suelta agua con superficie libre. Es otra discretización del fluido; no es el mismo código que Stam, aunque ambos pueden verse “como agua de verdad”.

---

## 06 — PIC / FLIP (partículas + grilla)

[Abrir demo](./06-particulas-pic-flip-muller/index.html)

Ahora el agua son **partículas** que llevan posición y velocidad. Para calcular fuerzas/presión se **transfieren** datos a una grilla (PIC), se resuelve ahí (por ejemplo proyección), y se **devuelve** velocidad a las partículas. FLIP mezcla eso con el incremento de velocidad de la grilla para conservar mejor detalles y menos difusión numérica que PIC puro.

Demo de Matthias Müller (*Ten Minute Physics*): buen contraste visual con los métodos 100 % eulerianos (solo grilla) de 01–04.

---

## 07 — MLS-MPM (Material Point Method)

[Abrir demo](./07-mls-mpm-material-point-method/index.html)

MPM también es híbrido: **puntos de materia** + grilla de fondo. En cada paso se esparce información de partículas a la grilla, se actualiza el momento ahí, y se interpola de vuelta (con pesos MLS — Moving Least Squares — en esta variante). Sirve para fluidos y también para sólidos blandos; acá lo usamos como demo de fluido 2D (con worker).

Familia cercana a PIC/FLIP, con otro acento en cómo se transferen y deforman las cantidades.

---

## 08 — MPM / PVFS (demo externa)

[Abrir demo](./08-mpm-pvfs-demo-externa/index.html)

Demo de referencia visual (capas líquidas interactivas, build externo). No es el lugar para diseccionar el código en clase: sirve para mostrar **hasta dónde puede llegar** un solver MPM/PVFS pulido en el navegador, después de haber entendido 06–07.

---

## Cuadro comparativo (núcleo 01–04)

| | 01 CA columna | 02 Fick–Jacobi | 03 Lab mangueras | 04 Stam MAC |
|--|---------------|----------------|------------------|-------------|
| **Presión** | Heurística por columna / fill | Exceso `N − N_reposo` | Diferencia de cantidad en caras (+ Stam opcional) | Poisson Jacobi → corrige `v` |
| **Cómo se mueve la masa** | Transferencias locales (g, ΔP, desborde) | Fick + falling sand | Empuje de mangueras + flechas/raycast | Advección semi-Lagrangiana |
| **¿Incompresible?** | No | No | Parcial (proyección light) | Sí (objetivo `div ≈ 0`) |
| **Rol del “flow”** | Casi solo visual | `V` inercial que sesga Fick | Flechas + empujes MAC | Velocidad del fluido |

Mensaje unificador para la pizarra:

> Misma grilla 2D. Cambia **quién define la presión** y **quién mueve la masa**.

Ojo: la palabra **flowfield** en 02/03 no significa lo mismo que la **velocidad MAC** de 04.

---

## Cómo dictar (tiempos orientativos)

Clase de ~90–120 min:

1. **01** (10–15 min) — “funciona para juegos; no es CFD”. Density / Pressure / Vectors.
2. **02** (20–25) — reposo, exceso, vaso en U, inercia de `V`.
3. **03** (20–25) — knobs: mangueras vs flechas; prender/apagar proyección.
4. **04** (25–30) — pipeline completo; mirar `divMax`.
5. **05–08** si sobra — “misma meta, otra discretización” (red LBM / partículas / MPM).

Si la clase es corta: solo **01, 02 y 04**, y usá **03** como estación de 10 minutos para conectar ideas.

---

## Referencias (`_refs/`)

Material que no es paso obligatorio del recorrido, pero ayuda a contextualizar:

- [CA de masa conservada (antecedente visual del 02)](./_refs/ca-masa-conservada.html) — reposo, presión visual, vaso en U.
- [Inside LiquidFun (PDF)](./_refs/Inside%20LiquidFun.pdf) — lectura sobre un motor de líquidos 2D de producción.

En este mismo directorio también pueden aparecer submódulos o demos hermanas (`SPHjs`, `water-caves-simulator-2d`, etc.) que no forman parte del hilo numerado 01–08.
