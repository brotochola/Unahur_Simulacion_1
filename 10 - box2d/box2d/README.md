# Unidad 10: Box2D

Clase interactiva sobre motores de física de cuerpos rígidos con **Phaser Box2D** (el port a JavaScript de Box2D v3).

Abrí `index.html` con doble click: no hace falta servidor. Cada página es un HTML independiente que solo necesita `phaser-box2d.js` en la misma carpeta (y conexión para las tipografías).

| Página | Tema |
|---|---|
| `01-cuerpo-rigido.html` | Masa, inercia, torque, drag; Euler, semi-implícito, Verlet, RK4; impulsos contra posiciones |
| `02-mundo.html` | Phaser Box2D, ids y definiciones, metros, paso fijo, determinismo, subpasos |
| `03-cuerpos.html` | Tipos de cuerpo, masa, fuerzas e impulsos, drag, rotación fija, dormir |
| `04-formas.html` | Círculo, cápsula, polígono, segmento, cadena; envolvente convexa; fricción y rebote |
| `05-colisiones.html` | AABB/OBB, árbol dinámico (BVH), SAT, manifolds, contactos especulativos y blandos |
| `06-eventos.html` | Filtros, sensores, eventos de contacto y de golpe, pre-solve |
| `07-joints.html` | Los siete joints, auto, puente que se rompe, ragdolls |
| `08-consultas.html` | Rayos, visión, shape casts, superposiciones, explosiones |
| `09-solver.html` | Soft step, warm starting, coloreo del grafo, islas, CCD, rendimiento |
| `10-juegos.html` | Integración con Phaser, interpolación, plataformero, honda, errores típicos |
| `editor.html` | Editor de escenas: dibujar, simular, guardar y exportar código |

## Sobre `phaser-box2d.js`

Es `phaser-box2d` 1.1.0 de npm (MIT, Phaser Studio; Box2D de Erin Catto) empaquetado como script clásico con el global `B2`, con tres arreglos marcados `[parche]`:

1. `b2RayCastShape` reusaba el objeto de entrada y lo pisaba con coordenadas locales: los rayos del mundo fallaban con más de una forma.
2. `b2ShapeCastShape` tenía el mismo problema (afecta a `b2World_CastCircle`, `CastCapsule` y `CastPolygon`).
3. `b2World_CastRayClosest` no guardaba el filtro y tiraba error.

El capítulo 8 explica los bugs y cómo aplicar el mismo arreglo en un proyecto que use la librería de npm.
