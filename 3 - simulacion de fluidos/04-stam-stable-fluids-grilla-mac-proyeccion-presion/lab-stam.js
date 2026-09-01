(() => {
  "use strict";

  const CORE = globalThis.LAB_STAM;
  const {
    AIRE,
    PIEDRA,
    AGUA,
    MATERIALES,
    esFluido,
    clamp,
    vacia,
    config,
    Mundo,
    ordenPasos,
    restablecerPasos,
    restablecerMateriales,
    medirMasa: medirMasaCore,
  } = CORE;

  let ANCHO = 140;
  let ALTO = 90;
  const CELL_PX = 6;

  const fmtKnob = (v, step) => {
    if (step >= 1) return String(Math.round(v));
    if (step < 0.01) return Number(v).toFixed(4);
    return Number(v).toFixed(2);
  };

  const debug = {
    ticksPorFrame: 1,
    fpsSim: 60,
    overlayVelocidad: false,
    escalaVectores: 4,
    densidadVectores: 2,
    cellPx: CELL_PX,
  };
  const cellPx = () => debug.cellPx ?? CELL_PX;

  const tiemposPaso = {};
  let tiempoTick = 0;
  let pasoAbiertoId = "proyeccion";

  let mundo = new Mundo(ANCHO, ALTO);
  let corriendo = true;
  let ticks = 0;
  let materialPincel = AGUA;
  let radioPincel = 3;
  let intensidadPincel = 16;
  let pintando = false;
  let hoverCelda = null;
  let masaAnterior = 0;
  let deltaMasa = 0;

  function escenaInicial() {
    mundo.limpiar();
    const rest = MATERIALES[AGUA].reposo;
    const yPiso = ALTO - 1;
    const yAgua = Math.floor((ALTO * 2) / 3);
    for (let x = 0; x < ANCHO; x++) mundo.pintar(x, yPiso, 0, PIEDRA, 1);
    for (let y = 0; y < ALTO; y++) {
      mundo.pintar(0, y, 0, PIEDRA, 1);
      mundo.pintar(ANCHO - 1, y, 0, PIEDRA, 1);
    }
    for (let y = yAgua; y < yPiso; y++) {
      for (let x = 1; x < ANCHO - 1; x++) mundo.pintar(x, y, 0, AGUA, rest);
    }
  }

  function tick() {
    tiempoTick = CORE.tick(mundo, tiemposPaso);
    ticks++;
  }

  const medirMasa = () => medirMasaCore(mundo);

  const canvas = document.getElementById("lienzo");
  const ctx = canvas.getContext("2d");
  let bufferChico = null;
  let ctxChico = null;
  let imgData = null;

  function redimensionarLienzo() {
    const px = cellPx();
    canvas.width = ANCHO * px;
    canvas.height = ALTO * px;
    ctx.imageSmoothingEnabled = false;
    if (
      !bufferChico ||
      bufferChico.width !== ANCHO ||
      bufferChico.height !== ALTO
    ) {
      bufferChico = document.createElement("canvas");
      bufferChico.width = ANCHO;
      bufferChico.height = ALTO;
      ctxChico = bufferChico.getContext("2d");
      imgData = ctxChico.createImageData(ANCHO, ALTO);
    }
  }
  redimensionarLienzo();

  function dibujarCampo(fx, fy, color, cada, escala) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    const px = cellPx();
    const { material, cantidad } = mundo;
    for (let y = 0; y < ALTO; y += cada) {
      for (let x = 0; x < ANCHO; x += cada) {
        const i = mundo.idx(x, y);
        if (!esFluido(material[i]) || vacia(cantidad[i])) continue;
        const mag = Math.hypot(fx[i], fy[i]);
        if (mag < 0.05) continue;
        const ox = (x + 0.5) * px;
        const oy = (y + 0.5) * px;
        const largo = mag * px * escala * 0.5;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + (fx[i] / mag) * largo, oy + (fy[i] / mag) * largo);
        ctx.stroke();
      }
    }
  }

  function render() {
    const { material, cantidad, vx, vy } = mundo;
    const datos = imgData.data;
    for (let y = 0; y < ALTO; y++) {
      for (let x = 0; x < ANCHO; x++) {
        const i = mundo.idx(x, y);
        const idMat = material[i];
        const mat = MATERIALES[idMat];
        const p = (y * ANCHO + x) * 4;
        if (mat.esVacio) {
          datos[p] = mat.color[0];
          datos[p + 1] = mat.color[1];
          datos[p + 2] = mat.color[2];
          datos[p + 3] = 255;
          continue;
        }
        let r = mat.color[0],
          g = mat.color[1],
          b = mat.color[2];
        if (idMat === AGUA) {
          const reposo = mat.reposo || 1;
          const ratio = cantidad[i] / reposo;
          const t = ratio <= 1 ? ratio : 1 + Math.min(1, (ratio - 1) / 2);
          r = 8 + (20 - 8) * Math.min(1, t);
          g = 40 + (110 - 40) * Math.min(1, t);
          b = 90 + (190 - 90) * Math.min(1, t);
          if (t > 1) {
            const u = t - 1;
            r = 20 + (90 - 20) * u;
            g = 110 + (190 - 110) * u;
            b = 190 + (230 - 190) * u;
          }
          let foam = 0;
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ]) {
            const nx = x + dx,
              ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= ANCHO || ny >= ALTO) continue;
            if (material[mundo.idx(nx, ny)] === AIRE) {
              foam = 0.45;
              break;
            }
          }
          r += (255 - r) * foam;
          g += (255 - g) * foam;
          b += (255 - b) * foam;
        }
        datos[p] = r;
        datos[p + 1] = g;
        datos[p + 2] = b;
        datos[p + 3] = 255;
      }
    }
    ctxChico.putImageData(imgData, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      bufferChico,
      0,
      0,
      ANCHO,
      ALTO,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    if (debug.overlayVelocidad) {
      const cada = clamp(Math.round(debug.densidadVectores), 1, 8);
      dibujarCampo(vx, vy, "rgb(107, 227, 160)", cada, debug.escalaVectores);
    }
  }

  let accSim = 0;
  let tCuadroAnt = 0;
  function cuadro(tAhora) {
    if (!tCuadroAnt) tCuadroAnt = tAhora;
    const dt = tAhora - tCuadroAnt;
    tCuadroAnt = tAhora;
    if (corriendo) {
      const fps = Math.max(0.5, debug.fpsSim || 60);
      const intervalo = 1000 / fps;
      accSim += dt;
      let disparos = 0;
      while (accSim >= intervalo && disparos < 8) {
        for (let n = 0; n < debug.ticksPorFrame; n++) tick();
        accSim -= intervalo;
        disparos++;
      }
      if (accSim > intervalo * 8) accSim = 0;
    }
    render();
    actualizarLectura();
    requestAnimationFrame(cuadro);
  }

  function resumenPaso(paso) {
    if (!paso.knobs.length) return "sin knobs";
    return paso.knobs
      .map((k) => `${k.corto} ${fmtKnob(paso.cfg[k.key], k.step)}`)
      .join(" · ");
  }

  function campoSlider(
    contenedor,
    etiqueta,
    valorInicial,
    min,
    max,
    paso,
    onChange,
    tooltip,
  ) {
    const div = document.createElement("div");
    div.className = "campo";
    if (tooltip) div.title = tooltip;
    const label = document.createElement("label");
    const spanTxt = document.createElement("span");
    spanTxt.textContent = etiqueta;
    const spanVal = document.createElement("b");
    spanVal.textContent = fmtKnob(valorInicial, paso);
    label.append(spanTxt, spanVal);
    const input = document.createElement("input");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = paso;
    input.value = valorInicial;
    if (tooltip) input.title = tooltip;
    input.addEventListener("input", () => {
      const v = Number(input.value);
      spanVal.textContent = fmtKnob(v, paso);
      onChange(v);
    });
    div.append(label, input);
    contenedor.appendChild(div);
  }

  function campoCheck(contenedor, etiqueta, valor, onChange, tooltip) {
    const label = document.createElement("label");
    label.className = "check-fila";
    if (tooltip) label.title = tooltip;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = valor;
    input.addEventListener("change", () => onChange(input.checked));
    const span = document.createElement("span");
    span.textContent = etiqueta;
    label.append(input, span);
    contenedor.appendChild(label);
  }

  function plegarPanel(panel, abierto) {
    const h2 = panel.querySelector("h2");
    const cuerpo = document.createElement("div");
    cuerpo.className = "panel-cuerpo";
    while (h2.nextSibling) cuerpo.appendChild(h2.nextSibling);
    panel.appendChild(cuerpo);
    if (!abierto) panel.classList.add("cerrado");
    h2.addEventListener("click", () => panel.classList.toggle("cerrado"));
  }

  plegarPanel(document.getElementById("panel-pipeline"), true);
  plegarPanel(document.getElementById("panel-escenarios"), true);
  plegarPanel(document.getElementById("panel-debug"), true);
  plegarPanel(document.getElementById("panel-pincel"), true);

  const listaPasos = document.getElementById("lista-pasos");
  function renderizarListaPasos() {
    listaPasos.innerHTML = "";
    ordenPasos.forEach((paso, indice) => {
      const li = document.createElement("li");
      if (!paso.activo) li.classList.add("desactivado");
      if (paso.id === pasoAbiertoId) li.classList.add("abierto");

      const cab = document.createElement("div");
      cab.className = "paso-cabecera";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = paso.activo;
      check.title = paso.activo ? "Apagar este paso" : "Prender este paso";
      check.addEventListener("change", () => {
        paso.activo = check.checked;
        renderizarListaPasos();
      });

      const nombre = document.createElement("span");
      nombre.className = "nombre";
      nombre.textContent = paso.nombre;
      nombre.title =
        (paso.tooltip || "") + " Click para abrir/cerrar su config.";
      nombre.addEventListener("click", () => {
        pasoAbiertoId = pasoAbiertoId === paso.id ? null : paso.id;
        renderizarListaPasos();
      });

      const subir = document.createElement("button");
      subir.className = "mini";
      subir.textContent = "↑";
      subir.title = "Mover este paso antes";
      subir.disabled = indice === 0;
      subir.addEventListener("click", () => {
        [ordenPasos[indice - 1], ordenPasos[indice]] = [
          ordenPasos[indice],
          ordenPasos[indice - 1],
        ];
        renderizarListaPasos();
      });

      const bajar = document.createElement("button");
      bajar.className = "mini";
      bajar.textContent = "↓";
      bajar.title = "Mover este paso después";
      bajar.disabled = indice === ordenPasos.length - 1;
      bajar.addEventListener("click", () => {
        [ordenPasos[indice + 1], ordenPasos[indice]] = [
          ordenPasos[indice + 1],
          ordenPasos[indice],
        ];
        renderizarListaPasos();
      });

      cab.append(check, nombre, subir, bajar);
      li.appendChild(cab);

      if (paso.desc) {
        const desc = document.createElement("div");
        desc.className = "paso-resumen";
        desc.textContent = paso.desc;
        li.appendChild(desc);
      }

      if (paso.id === pasoAbiertoId) {
        const cuerpo = document.createElement("div");
        cuerpo.className = "paso-cuerpo";
        if (paso.ayuda) {
          const p = document.createElement("p");
          p.className = "paso-ayuda";
          p.textContent = paso.ayuda;
          cuerpo.appendChild(p);
        }
        paso.knobs.forEach((k) => {
          campoSlider(
            cuerpo,
            k.label,
            paso.cfg[k.key],
            k.min,
            k.max,
            k.step,
            (v) => {
              paso.cfg[k.key] = v;
            },
            k.tooltip,
          );
        });
        li.appendChild(cuerpo);
      } else {
        const res = document.createElement("div");
        res.className = "paso-resumen";
        res.textContent = resumenPaso(paso);
        res.title = paso.tooltip || "";
        li.appendChild(res);
      }

      listaPasos.appendChild(li);
    });
  }
  renderizarListaPasos();

  const btnPlay = document.getElementById("btn-play");
  btnPlay.addEventListener("click", () => {
    corriendo = !corriendo;
    btnPlay.textContent = corriendo ? "⏸ Pausar" : "▶ Reanudar";
    btnPlay.classList.toggle("activo", corriendo);
  });
  document.getElementById("btn-paso").addEventListener("click", () => {
    tick();
    render();
    actualizarLectura();
  });
  document.getElementById("btn-limpiar").addEventListener("click", () => {
    escenaInicial();
    ticks = 0;
    masaAnterior = medirMasa().total;
    deltaMasa = 0;
  });

  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Space") {
      e.preventDefault();
      btnPlay.click();
    } else if (e.key === "n" || e.key === "N") {
      document.getElementById("btn-paso").click();
    } else if (e.key === "l" || e.key === "L") {
      document.getElementById("btn-limpiar").click();
    }
  });

  const debugBox = document.getElementById("parametros-debug");
  campoSlider(
    debugBox,
    "Ticks por cuadro",
    debug.ticksPorFrame,
    1,
    6,
    1,
    (v) => {
      debug.ticksPorFrame = Math.round(v);
    },
    "Varios ticks cada vez que dispara el FPS de sim.",
  );
  campoSlider(
    debugBox,
    "FPS sim",
    debug.fpsSim,
    0.5,
    60,
    0.5,
    (v) => {
      debug.fpsSim = v;
    },
    "Ticks por segundo. El dibujo sigue a 60 Hz.",
  );
  campoSlider(
    debugBox,
    "Tamaño de celda",
    debug.cellPx,
    2,
    16,
    1,
    (v) => {
      debug.cellPx = Math.round(v);
      redimensionarLienzo();
      render();
    },
    "Píxeles por celda. No cambia ANCHO/ALTO de la grilla.",
  );
  campoCheck(
    debugBox,
    "Overlay velocidad de celda",
    debug.overlayVelocidad,
    (v) => {
      debug.overlayVelocidad = v;
    },
    "Flechas verdes = v centrado (promedio de las 4 caras MAC).",
  );
  campoSlider(
    debugBox,
    "Escala de vectores",
    debug.escalaVectores,
    0.5,
    8,
    0.1,
    (v) => {
      debug.escalaVectores = v;
    },
    "Largo de las flechas. No cambia la física.",
  );
  campoSlider(
    debugBox,
    "Densidad de vectores",
    debug.densidadVectores,
    1,
    8,
    1,
    (v) => {
      debug.densidadVectores = v;
    },
    "Una flecha cada N celdas.",
  );

  const configCampos = document.createElement("div");
  document.getElementById("config-global").appendChild(configCampos);
  function renderizarConfigGlobal() {
    configCampos.innerHTML = "";
    campoSlider(
      configCampos,
      "dt (paso temporal)",
      config.dt,
      0.1,
      3,
      0.1,
      (v) => {
        config.dt = v;
      },
      "Escala el tiempo de todos los pasos. Semi-Lagrangiana es estable para cualquier dt — subilo y mirá.",
    );
    campoSlider(
      configCampos,
      "Umbral celda fluida",
      config.epsFluido,
      0.001,
      1,
      0.001,
      (v) => {
        config.epsFluido = v;
      },
      "Cantidad mínima para que una celda cuente como fluido (y limpieza de masa muerta). Celda llena ≈ 8.",
    );
  }
  renderizarConfigGlobal();

  document
    .getElementById("btn-copiar-config")
    .addEventListener("click", async () => {
      const json = JSON.stringify(CORE.exportarConfig(), null, 2);
      try {
        await navigator.clipboard.writeText(json);
      } catch {
        prompt("Copiá la config (Ctrl+C):", json);
      }
    });
  document.getElementById("btn-pegar-config").addEventListener("click", () => {
    const txt = prompt("Pegá la config JSON:");
    if (!txt) return;
    try {
      CORE.importarConfig(JSON.parse(txt));
      renderizarListaPasos();
      renderizarConfigGlobal();
    } catch (e) {
      alert("Config inválida: " + e.message);
    }
  });

  const lectura = document.getElementById("lectura");
  function actualizarLectura() {
    const { total, vivas } = medirMasa();
    deltaMasa = total - masaAnterior;
    masaAnterior = total;
    const ms = ordenPasos
      .map(
        (p) =>
          `${p.id} ${tiemposPaso[p.id] ? tiemposPaso[p.id].toFixed(1) : "0.0"}ms`,
      )
      .join(" · ");
    const signo = deltaMasa > 0 ? "+" : "";
    let lineaHover = "";
    if (hoverCelda) {
      const i = mundo.idx(hoverCelda.x, hoverCelda.y);
      const mat = MATERIALES[mundo.material[i]];
      const n = mundo.cantidad[i];
      const hvx = mundo.vx[i];
      const hvy = mundo.vy[i];
      lineaHover = `celda ${hoverCelda.x},${hoverCelda.y} ${mat.nombre.toLowerCase()} n=${n.toFixed(1)} v=(${hvx.toFixed(2)}, ${hvy.toFixed(2)})`;
    }
    lectura.innerHTML =
      `tick <b>${ticks}</b> · ${corriendo ? "corriendo" : "pausado"} · masa <b>${total.toFixed(1)}</b> Δ${signo}${deltaMasa.toFixed(1)} · vivas ${vivas} · divMax <b>${mundo.divergenciaMax.toFixed(3)}</b><br>` +
      `tick ${tiempoTick.toFixed(1)}ms · ${ms}` +
      (lineaHover ? `<br>${lineaHover}` : "");
  }

  const contenedorMateriales = document.getElementById("materiales");
  MATERIALES.filter((m) => m.id === AIRE || m.id === PIEDRA || m.id === AGUA).forEach(
    (mat) => {
      const sw = document.createElement("div");
      sw.className = "swatch" + (mat.id === materialPincel ? " sel" : "");
      sw.style.background = `rgb(${mat.color.join(",")})`;
      sw.title = mat.esVacio
        ? "Aire: borra la celda."
        : mat.esSolido
          ? "Piedra: pisa lo que haya."
          : `${mat.nombre}: SUMA intensidad por celda.`;
      sw.addEventListener("click", () => {
        materialPincel = mat.id;
        [...contenedorMateriales.children].forEach((c) =>
          c.classList.remove("sel"),
        );
        sw.classList.add("sel");
      });
      contenedorMateriales.appendChild(sw);
    },
  );

  const sliderRadio = document.getElementById("radio-pincel");
  const valorRadio = document.getElementById("valor-radio");
  sliderRadio.addEventListener("input", () => {
    radioPincel = Number(sliderRadio.value);
    valorRadio.textContent = radioPincel;
  });

  const sliderIntensidad = document.getElementById("intensidad-pincel");
  const valorIntensidad = document.getElementById("valor-intensidad");
  sliderIntensidad.addEventListener("input", () => {
    intensidadPincel = Number(sliderIntensidad.value);
    valorIntensidad.textContent = intensidadPincel;
  });

  function coordenadasCelda(evento) {
    const rect = canvas.getBoundingClientRect();
    const x = clamp(
      Math.floor(((evento.clientX - rect.left) / rect.width) * ANCHO),
      0,
      ANCHO - 1,
    );
    const y = clamp(
      Math.floor(((evento.clientY - rect.top) / rect.height) * ALTO),
      0,
      ALTO - 1,
    );
    return { x, y };
  }
  canvas.addEventListener("mousedown", (e) => {
    pintando = true;
    const { x, y } = coordenadasCelda(e);
    hoverCelda = { x, y };
    mundo.pintar(x, y, radioPincel, materialPincel, intensidadPincel);
  });
  window.addEventListener("mouseup", () => {
    pintando = false;
  });
  canvas.addEventListener("mousemove", (e) => {
    const { x, y } = coordenadasCelda(e);
    hoverCelda = { x, y };
    if (!pintando) return;
    mundo.pintar(x, y, radioPincel, materialPincel, intensidadPincel);
  });
  canvas.addEventListener("mouseleave", () => {
    hoverCelda = null;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      radioPincel = clamp(radioPincel + (e.deltaY < 0 ? 1 : -1), 1, 12);
      sliderRadio.value = radioPincel;
      valorRadio.textContent = radioPincel;
    },
    { passive: false },
  );

  // Escenarios locales (escenarios.js). Solo agua.
  const ESC = globalThis.LAB_ESCENARIOS;
  const selectEsc = document.getElementById("select-escenario");
  const descEsc = document.getElementById("desc-escenario");
  const btnCargarEsc = document.getElementById("btn-cargar-esc");

  if (!ESC || !Array.isArray(ESC.ESCENARIOS)) {
    console.error(
      "LAB_ESCENARIOS ausente: falta escenarios.js antes de lab-stam.js",
    );
    if (descEsc) descEsc.textContent = "Escenarios no disponibles (falta escenarios.js).";
    if (selectEsc) selectEsc.disabled = true;
    if (btnCargarEsc) btnCargarEsc.disabled = true;
  } else {
    const escenariosAgua = ESC.ESCENARIOS.filter((esc) => {
      if (esc.grilla && esc.grilla.some((f) => /[osL]/.test(f))) return false;
      if (esc.pintas && esc.pintas.some((p) => p.mat !== "AGUA")) return false;
      return true;
    });
    escenariosAgua.forEach((esc) => {
      const op = document.createElement("option");
      op.value = esc.id;
      op.textContent = `${esc.id} · ${esc.nombre}`;
      selectEsc.appendChild(op);
    });
    function mostrarDescEsc() {
      const esc = escenariosAgua.find((e) => e.id === selectEsc.value);
      descEsc.textContent = esc ? esc.descripcion || "" : "";
    }
    selectEsc.addEventListener("change", mostrarDescEsc);
    mostrarDescEsc();

    function cargarEscenario(esc) {
      mundo = ESC.construirEscenario(CORE, esc);
      ANCHO = esc.ancho;
      ALTO = esc.alto;
      ticks = 0;
      redimensionarLienzo();
      renderizarListaPasos();
      masaAnterior = medirMasa().total;
      deltaMasa = 0;
      render();
    }

    btnCargarEsc.addEventListener("click", () => {
      const esc = escenariosAgua.find((e) => e.id === selectEsc.value);
      if (esc) cargarEscenario(esc);
    });
  }

  document.getElementById("btn-escena-inicial").addEventListener("click", () => {
    restablecerPasos();
    restablecerMateriales();
    ANCHO = 140;
    ALTO = 90;
    mundo = new Mundo(ANCHO, ALTO);
    escenaInicial();
    ticks = 0;
    redimensionarLienzo();
    renderizarListaPasos();
    masaAnterior = medirMasa().total;
    deltaMasa = 0;
    render();
  });

  escenaInicial();
  masaAnterior = medirMasa().total;

  requestAnimationFrame(cuadro);
})();
