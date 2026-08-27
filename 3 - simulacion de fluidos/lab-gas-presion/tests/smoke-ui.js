// Smoke test de carga de lab.js con DOM stub: atrapa ReferenceErrors de la capa UI sin browser.
const fs = require("fs");
const path = require("path");
const base = path.join(__dirname, "..");

globalThis.LAB_CORE = require(path.join(base, "core.js"));
globalThis.LAB_ESCENARIOS = require(path.join(base, "escenarios.js"));

const anyObj = () =>
  new Proxy(function () {}, {
    get(t, k) {
      if (k === "nextSibling") return null;
      if (k === Symbol.toPrimitive) return () => 0;
      return anyObj();
    },
    set: () => true,
    apply: () => anyObj(),
  });

globalThis.window = anyObj();
globalThis.document = {
  getElementById: () => anyObj(),
  createElement: () => anyObj(),
};
globalThis.requestAnimationFrame = () => {};

const code = fs.readFileSync(path.join(base, "lab.js"), "utf8");
eval(code);
console.log("OK: lab.js carga sin errores");
