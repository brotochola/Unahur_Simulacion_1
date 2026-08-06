class SeededRandom {
  constructor(seed = 12345) {
    this.seed = seed;
  }
  
  // Devuelve un numero entre 0 y 1
  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  // Utilidad para distribucion exponencial (ideal para Eventos Aleatorios en DES)
  nextExponential(lambda) {
    return -Math.log(1 - this.next()) / lambda;
  }
}

window.RNG = new SeededRandom(12345); // Fixed seed para testing reproducible
