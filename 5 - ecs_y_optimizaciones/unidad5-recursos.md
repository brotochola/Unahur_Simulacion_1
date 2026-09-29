# Unidad 5 — Optimización de simulaciones: recursos por tema

Leyenda: 🖱️ interactivo/demo · 📄 lectura · 🎥 video · 🛠️ herramienta

---

## 1. Análisis de complejidad algorítmica (Big O) aplicado a simulaciones

- 🖱️ [samwho.dev/big-o](https://samwho.dev/big-o) — sliders en vivo mostrando cómo crecen O(1)/O(log n)/O(n)/O(n²).
- 🖱️ [VisuAlgo](https://visualgo.net/en) — animación paso a paso de algoritmos y estructuras de datos.
- 🖱️ [Big O Visualizer (thecoatlessprofessor)](https://web-apps.thecoatlessprofessor.com/coding/big-o-visualizer.html) — compara varias complejidades a la vez.
- 🖱️ [Big O Visualizer (luisllamas.es)](https://www.luisllamas.es/en/big-o-visualizer/) — versión simple, buena para arrancar.
- 🖱️ [Big-O Cheat Sheet](https://bigocheatsheet.com/) — gráfico + tabla de complejidad por estructura de datos.
- 📄 [Understanding Big O Notation via JavaScript (DigitalOcean)](https://www.digitalocean.com/community/tutorials/js-big-o-notation) — usa `performance.now()` para medir en JS real.
- 🎥 [Fireship — Big-O Notation in 100 Seconds](https://www.youtube.com/watch?v=g2o22C3CRfU) (EN)
- 🎥 [Notación Big O | Explicación y Análisis de la complejidad de un Algoritmo](https://www.youtube.com/watch?v=zbrXClNX0Yg) (ES)
- 🎥 [Complejidad Algorítmica sin llorar - Notación Big O](https://www.youtube.com/watch?v=UPDjjuz1Hkw) (ES)

---

## 2. Array of Structures vs. Structure of Arrays (SoA) / Data-Oriented Design

- 🖱️ [measurethat.net — OOP-ish SoA vs AoS](https://measurethat.net/Benchmarks/Show/33991/1/oop-ish-soa-vs-aos) — benchmark JS corrible en vivo.
- 🖱️ [measurethat.net — Classes SoA vs AoS](https://measurethat.net/Benchmarks/Show/33990/1/classes-soa-vs-aos) — variante con clases.
- 📄 [dataorienteddesign.com](https://dataorienteddesign.com/site.php?postid=122) — libro completo gratis sobre DOD + más recursos.
- 📄 [Wikipedia — AoS and SoA](https://en.wikipedia.org/wiki/AoS_and_SoA) — definición formal con ejemplos de código.
- 🎥 [Mike Acton — Data-Oriented Design and C++](https://www.youtube.com/watch?v=rX0ItVEVjHc) (EN, CppCon 2014, la charla de referencia)
- 🎥 [Scott Meyers — CPU Caches and Why You Care](https://www.youtube.com/watch?v=WDIkqP4JbkE) (EN, complementa el punto 3)

---

## 3. Impacto del acceso a memoria: cache misses y comportamiento del GC

- 🖱️ [Interactive Latency Numbers (colin-scott.github.io)](https://colin-scott.github.io/personal_website/research/interactive_latency.html) — slider temporal de latencias L1/L2/RAM/disco/red.
- 🖱️ [Chrome DevTools — Memory panel](https://developer.chrome.com/docs/devtools/memory) — herramienta real para tomar heap snapshots en vivo.
- 📄 [Gallery of Processor Cache Effects (igoro.com)](https://igoro.com/archive/gallery-of-processor-cache-effects/) — 7 experimentos con benchmarks de cache misses.
- 📄 [v8.dev/blog/trash-talk](https://v8.dev/blog/trash-talk) — el recolector Orinoco de V8 (con video incluido).
- 📄 [v8.dev/blog/orinoco](https://v8.dev/blog/orinoco) — versión técnica del GC de V8.
- 📄 [v8.dev/blog/elements-kinds](https://v8.dev/blog/elements-kinds) — cómo V8 clasifica arrays internamente (conecta con el punto 2).
- 🎥 [Scott Meyers — CPU Caches and Why You Care](https://www.youtube.com/watch?v=WDIkqP4JbkE) (EN)
- 🎥 [Cache Miss Types Explained (The 4 C's)](https://www.youtube.com/watch?v=YXkfmyb0_eA) (EN)
- 🎥 [¿Qué es y cómo funciona la memoria caché de tu CPU?](https://www.youtube.com/watch?v=xXKl3NQvr5w) (ES, introductorio)
- 🎥 [How does garbage collection work in JavaScript? Deep dive](https://www.youtube.com/watch?v=FZkCh_GeftY) (EN)

---

## 4. El método científico aplicado a la optimización

- 🖱️ [jsbench.me](https://jsbench.me) — plantear hipótesis y testearlas en vivo con snippets lado a lado.
- 🛠️ [tachometer (Google)](https://github.com/google/tachometer) — benchmarking riguroso con intervalos de confianza.
- 📄 [Thoughts on performance & optimization (Drew DeVault)](https://drewdevault.com/2020/02/21/Thoughts-on-performance.html) — hipótesis → predicción → test → conclusión.
- 📄 _The Mature Optimization Handbook_ (Carlos Bueno) — descarga gratis vía [dataorienteddesign.com](https://dataorienteddesign.com/site.php?postid=122).
- 🎥 [The magic of performance optimisation](https://www.youtube.com/watch?v=1C2Wxn90tWc) (EN)

---

## 5. Benchmarking comparativo — Juego de la Vida (OOP vs SoA)

- 🖱️ [github.com/Jumbub/game-of-life-js](https://github.com/Jumbub/game-of-life-js) — log commit a commit optimizando un GoL en TS (naive → typed arrays → workers), con demo.
- 📄 [github.com/barnex/life](https://github.com/barnex/life) — GoL en C con bit-packing (16 celdas por entero de 64 bits).
- 📄 [How I optimized Conway's Game of Life (Medium)](https://medium.com/tebs-lab/optimizing-conways-game-of-life-12f1b7f2f54c) — casi un tutorial en texto, usando el profiler de Chrome.
- 🎥 [Programming the Game of Life in JavaScript](https://www.youtube.com/watch?v=x5n5QlxLzLU) (EN, implementación base)

---

## 6. WebAssembly

- 🖱️ [squoosh.app](https://squoosh.app) — compresión de imágenes con códecs en WASM (Google Chrome Labs).
- 🖱️ [webassembly.studio](https://webassembly.studio) — IDE online: escribís C/Rust/WAT y lo corrés en el navegador.
- 🖱️ [mandelbrot.jma.gg](https://mandelbrot.jma.gg) — alterná entre WASM single-thread y WASM+Web Workers sobre el mismo cálculo.
- 📄 [Figma — WebAssembly cut Figma's load time by 3x](https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x/)
- 📄 [Figma — Building a professional design tool on the web](https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/)
- 🎥 [Lin Clark — A Cartoon Intro to WebAssembly](https://www.youtube.com/watch?v=HktWin_LPf4) (EN, JSConf EU 2017, la introducción clásica)
- 🎥 [¿Qué es y cómo funciona WebAssembly?](https://www.youtube.com/watch?v=xWz9mUlaA84) (ES, Platzi)
- 🎥 [Qué es Web Assembly](https://www.youtube.com/watch?v=_17Y0IeiWtQ) (ES, Código Facilito)

---

## 7. Bitwise Operations: bit masking, bit packing, bit shifting

- 🖱️ [Binary Calculator (OpenReplay)](https://openreplay.com/tools/binary-calculator/) — AND/OR/XOR/NOT/shifts con resultado en binario/decimal/hex.
- 🖱️ [Number Base Converter con bits clickeables (hidekazu-konishi.com)](https://hidekazu-konishi.com/tools/number_base_converter_tool.html)
- 🖱️ [JSFiddle — Bitwise Operators Playground](https://jsfiddle.net/chris407x/0L17g2xv/) — de la serie "Bitmasks for Fun and Profit".
- 📄 [GeeksforGeeks — What is Bitmasking in JavaScript](https://www.geeksforgeeks.org/?p=1044856)
- 📄 [Introduction to Bitwise Operators (torusheadstudios)](https://torusheadstudios.substack.com/p/introduction-to-bitwise-operators) — enfocado en web devs.
- 🎥 [Bitwise Operations & Bit Masking](https://www.youtube.com/watch?v=ffPOA7UUDAs) (EN)
- 🎥 [Cómo funcionan los operadores bitwise o bit a bit](https://m.youtube.com/watch?v=P9d-7ETuM2M) (ES)

---

## 8. Multithreading (Web Workers en el navegador)

- 🖱️ [Web Worker Demo (dannyguo.com)](https://www.dannyguo.com/web-worker-demo) — con y sin worker, el reloj se congela en vivo.
- 🖱️ [mandelbrot.jma.gg](https://mandelbrot.jma.gg) — variar cantidad de workers sobre el mismo cálculo.
- 🖱️ [github.com/Zazzik1/Mandelbrot](https://www.github.com/Zazzik1/Mandelbrot) — Mandelbrot con Web Workers + Canvas, código simple de leer.
- 📄 [MDN — Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
- 🎥 [PARALELISMO con JavaScript | WebWorkers, multi-hilo. FÁCIL!](https://www.youtube.com/watch?v=lVd8K_ntKKk) (ES)
- 🎥 [How to Parallelize Tasks in JavaScript | Using Web Workers for Multithreading](https://www.youtube.com/watch?v=pNbfEKhRoZk) (EN)

---
