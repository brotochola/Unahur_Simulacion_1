# Fluido celular Fick–Jacobi + Flowfield

Simulador 2D de fluido en grilla (cada celda ≈ un milímetro cúbico de agua).
La presión depende de la **cantidad de partículas por encima del reposo** (como un gas comprimido), no de la altura de la columna. Los vasos comunicantes aparecen cuando ese exceso empuja más fuerte que la gravedad.

**Nombre informal del modelo:** Fick–Jacobi Cell Fluid — flujo celular por difusión de Fick con esquema Jacobi, gravedad tipo falling-sand y flowfield inercial.

No es un nombre académico único: es un híbrido de piezas conocidas (autómatas de masa conservada, Fick, Jacobi, falling sand, flow fields).

## Cómo correrlo

Abrí `index.html` en el navegador (con un servidor local si hace falta; WebGL2 suele andar también en `file://`).

1. Arranca en **Pausa**
2. **Cargar Vaso en U** (o pintar Agua / Pared)
3. **Reanudar**, o usar Paso (Frame / Substep)

## Idea física

### Reposo

- `N_reposo` (`cfg.restCapacity`): masa “llena” de una celda en equilibrio.
- Si `N < N_reposo` → la celda **no genera outflow** por difusión ni por flowfield (sí puede recibir).
- Exceso / “presión”: `C = max(0, N - N_reposo)`.

### Difusión (Ley de Fick + Jacobi)

Hacia cada vecino de Moore (8 direcciones):

```text
J_ij = D * (C_i - mass_j) * invDist_ij   // solo si J > 0
```

Equivalente a “ganas” ≈ exceso_i − masa_vecino (aire = 0).

1. Se copia `massRead → massWrite` solo en chunks en proceso (`copyProcessCells`)
2. Se leen vecinos solo de `massRead` y se escriben flujos en `massWrite`
3. Si la suma de outflows > exceso → se **escalan** (no baja bajo reposo)
4. `swap(massRead, massWrite)`

Knob: **Difusión Fick (D)** — `cfg.diffusion` (tope UI ~0.25).

### Gravedad (falling sand)

Término aparte, después del swap:

1. Abajo
2. Diagonales abajo (L/R aleatorio)
3. Laterales (L/R aleatorio)

Mueve hasta `cfg.gravity` partículas por substep. Independiente del flowfield.

### Flowfield

- Target = suma de `dirección × flujo_real` (Fick + gravedad) del substep.
- `V = lerp(V, target, alpha)`.
- Sin transferencia / masa muerta → target `(0,0)` → V tiende a 0.
- Snap: si `|V|² < cfg.flowSnapSq` → V = 0.
- Influencia en Fick (solo si `N ≥ N_reposo`):
  `J += max(0, dot(V, dir) * cfg.flowInfluence)`.

## Arquitectura

```text
index.html
css/styles.css
js/
  config.js       — tipos AIR/SOLID/WATER, knobs, vecindad
  grids.js        — SoA typed arrays + ping/pong (CPU / seed GPU)
  chunks.js       — spatial hash (path CPU)
  physics.js      — Fick → gravedad → flowfield (referencia CPU)
  gpu-physics.js  — mismos pasos en WebGL2 fragment ping-pong
  renderer.js     — state textures + colorize WebGL2 / ImageData
  perf.js         — FPS + sim/render/frame/gpu ms
  input.js        — mouse / pincel → CPU + upload GPU
  ui.js           — knobs, preset U, inspector
  main.js         — loop rAF
  smoke-check.js  — tests headless CPU (Node)
```

### Path GPU (default)

Estado en texturas `RGBA32F` (R=mass, G=type, B=flowX, A=flowY), ping-pong + FBO.

Por substep: **Fick gather** → **gravedad approx** → **flowfield** (+ avg opcional) → **colorize** fullscreen.

- CPU solo: brush, presets, knobs, inspector (`readPixels` 1×1), masa total periódica.
- Gravedad GPU ≠ falling-sand bit-exact (sin barrido bottom-up); ver comentario `ponytail:` en `gpu-physics.js`.
- Chunk sleep apagado en path GPU (full-grid pass).

### Path CPU (referencia)

| Buffer | Uso |
|--------|-----|
| `typeGrid` | AIR / SOLID / WATER |
| `massPing` / `massPong` | doble buffer Jacobi |
| `flowX`, `flowY` | vector flowfield |

Chunks: sleep + anillo 3×3. Render ImageData o upload bridge a state texture.

## Controles importantes

| Control | Efecto |
|---------|--------|
| Partículas en reposo | `N_reposo` por celda |
| Difusión Fick (D) | fuerza de la presión/difusión |
| Gravedad | rate falling-sand |
| Lerp / Influencia flowfield | inercia y peso de V en el outflow |
| Masa min / Flow snap | umbrales anti-ruido |
| Rojo = partículas (presión) | `cfg.pressureRedAt` seteable; max del slider = max masa WATER |
| Espuma por velocidad | `cfg.foamVelScale` — blanco por `|V|` en modo Agua |
| Tamaño del pincel | radio en celdas |
| Partículas por pincel | cuánta masa suma el agua por celda/frame |
| Substeps | pasos físicos por frame |
| Culling chunks | ON = solo regiones activas |

## Smoke test

```bash
node js/smoke-check.js
```

Verifica path CPU: conservación de masa (Fick, g=0), celda bajo reposo no pierde, difusión a vecinos, chunks vivos, swap ping-pong.

GPU (Chrome con WebGL2), servir la carpeta y abrir `js/gpu-smoke.html` — conservación Fick + gravedad approx.

## Qué no es

- No es Navier–Stokes / SPH / LBM clásico.
- No usa presión hidrostática por altura (`ρgh`).
- No usa Gauss–Seidel / red-black in-place (quedó fuera a propósito).

## Referencias en esta carpeta

- `4.html` — UI studio, chunks, flowfield inercial.
- `Mass-Conserving Cellular Automata.html` — reposo, presión visual, vaso en U.
