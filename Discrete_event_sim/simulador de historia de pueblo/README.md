# Mini Simulador de Comunidad Emergente — Fase 1 + Fase 2 + Fase 3 + Fase 4

Implementación de la **simulación básica** (tiempo, personas, necesidades, acciones),
el **sistema de eventos** (historial consultable), las **relaciones/afinidad** y las
**parejas** descritas en el documento de diseño. Las fases 5 en adelante (hijos,
depósito común, accidentes, estaciones, clima, personalidad, narrativa) todavía
no están implementadas, pero la arquitectura está pensada para agregarlas sin
reescribir lo existente.

## Cómo correrlo

```bash
node index.js
```

Esto crea las 8 personas iniciales y corre 5 días de simulación (ajustable en
`index.js` con `DIAS_A_SIMULAR`), imprimiendo el historial de eventos y el
estado final de cada persona.

## Estructura

```
src/
  Time.js            → reloj de la simulación (hora/día)
  World.js            → recursos lógicos del mundo (bosque, lago, campamento)
  Person.js           → estado de cada persona + decisión de próxima acción
  ActionSystem.js      → catálogo de acciones (duración + efectos)
  EventQueue.js        → emisión de eventos con timestamp
  History.js          → almacenamiento y consulta del historial
  ResourceManager.js   → preparado para el depósito común (Fase 6)
  RelationshipSystem.js → afinidad entre pares de personas (Fase 3)
  Simulation.js        → orquesta el avance hora a hora
index.js              → punto de entrada de ejemplo
```

Cada sistema tiene una única responsabilidad, como pide el documento:

- **Person** decide QUÉ acción quiere hacer (prioridades simples: hambre,
  energía), pero no sabe CÓMO se ejecuta.
- **ActionSystem** sabe CÓMO se ejecuta cada acción (duración, efectos), pero
  no decide cuándo se usa.
- **EventQueue** sólo transporta eventos con timestamp; no le importa su
  significado.
- **History** sólo almacena y permite consultar; no genera eventos.
- **Simulation** sólo orquesta el ciclo hora a hora, delegando todo lo demás.

## Decisiones de diseño relevantes

- **Sin posiciones**: tal como pide el documento, no hay coordenadas ni mapa
  físico. `World` sólo modela abundancia relativa por tipo de recurso
  (bosque/lago/campamento), que en fases futuras será modificada por
  estaciones y clima.
- **Prioridades simples, no IA**: `Person.decideNextAction()` es una cadena de
  condicionales sencilla (hambre crítica → energía baja → acción productiva al
  azar). No hay planificación ni aprendizaje.
- **Acciones como catálogo de datos**: agregar una acción nueva es agregar una
  entrada a `ActionSystem.ACTIONS` con su duración y efecto — no hace falta
  tocar el resto del sistema ni añadir condicionales gigantes en otro lado.
- **Dormir hasta la mañana**: se calcula dinámicamente cuántas horas faltan
  hasta las 06:00 en el momento de iniciar la acción, en vez de usar una
  duración fija.
- **Afinidad sin posiciones ni "encuentros" explícitos**: como el mundo no
  tiene coordenadas, "coincidir" se define como que dos o más personas
  *inician la misma acción en la misma hora*. Si esa acción es de trabajo
  (pescar, cortar madera, recolectar) y no hay escasez, sube la afinidad
  ("trabajaron juntos"); si hay escasez (poca comida promedio en la
  comunidad), la misma coincidencia se interpreta como competencia y la baja.
  Comer a la vez sube más la afinidad que trabajar juntos; permanecer juntos
  en el campamento equivale a "conversar" y sube un poco. Además, una persona
  con hambre extrema genera tensión (afinidad a la baja) con el resto del
  grupo cada hora que dura esa situación. Todo esto se calcula en
  `Simulation._actualizarRelaciones()`, que es el único lugar que conoce la
  regla de "qué cuenta como coincidencia"; `RelationshipSystem` sólo sabe
  sumar/restar y no le importa por qué.
- **Parejas emergen de la afinidad, no se fuerzan**: cada hora,
  `Simulation._formarParejas()` revisa los pares cuya afinidad superó el
  umbral (`RelationshipSystem.paresConAfinidad()`); si ambos son adultos y
  están solteros, quedan emparejados y se emite el evento correspondiente.
  No hay ninguna regla que obligue a nadie a buscar pareja: es un efecto
  secundario de haber trabajado, comido o conversado juntos lo suficiente.

## Cómo se conectan las fases futuras (sin tocar lo existente)

- **Fase 5 (Hijos)**: usa los campos `hijos`, `padres` que ya existen en
  `Person`, un temporizador de embarazo similar al patrón de acciones con
  duración, y una etapa (`bebé`/`niño`/`adolescente`/`adulto`) derivada de
  `edad` que decide qué puede hacer cada persona.
- **Fase 6 (Depósito común)**: `ResourceManager` ya existe como punto de
  entrada; sólo hay que cambiar `ActionSystem` para que `onComplete` deposite
  ahí en vez de en `comidaPersonal`/`maderaTransportada`.
- **Fase 7 (Accidentes)**: se agrega una probabilidad de accidente dentro de
  `onComplete` de las acciones riesgosas (pescar, cortar madera, recolectar),
  emitiendo un evento adicional.
- **Fase 8/9 (Estaciones/Clima)**: sólo necesitan modificar
  `World.abundancia` (y una probabilidad de accidente global); ni `Person` ni
  `ActionSystem` necesitan saber que existen estaciones.
- **Fase 10 (Personalidad)**: rasgos como pesos que modifican las
  probabilidades dentro de `Person.decideNextAction()`, sin cambiar su firma.
- **Fase 11 (Narrativa emergente)**: un filtro sobre `History` que selecciona
  eventos "importantes" (nacimientos, muertes, uniones, escaseces) según
  `meta.type`, sin generar texto narrativo manualmente.
