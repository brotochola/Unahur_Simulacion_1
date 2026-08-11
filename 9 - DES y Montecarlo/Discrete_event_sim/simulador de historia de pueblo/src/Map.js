class SimulationMap {
  constructor(containerId) {
    this.width = CONSTANTS.MAP_WIDTH;
    this.height = CONSTANTS.MAP_HEIGHT;
    this.tileSize = CONSTANTS.TILE_SIZE;

    // Crear aplicación PixiJS
    this.app = new PIXI.Application({
      width: this.width * this.tileSize,
      height: this.height * this.tileSize,
      backgroundColor: 0x223322,
    });

    document.getElementById(containerId).appendChild(this.app.view);

    // Grid data
    this.grid = [];
    this.sprites = [];

    // Contenedores PixiJS
    this.bgContainer = new PIXI.Container();
    this.entitiesContainer = new PIXI.Container();

    this.app.stage.addChild(this.bgContainer);
    this.app.stage.addChild(this.entitiesContainer);

    this.personSprites = new Map(); // id -> PIXI.Text
    this.houseSprites = new Map(); // id -> PIXI.Text

    this.noise = new window.SimplexNoise(window.RNG.next.bind(window.RNG));

    this.generateMap();
  }

  generateMap() {
    for (let y = 0; y < this.height; y++) {
      let row = [];
      let spriteRow = [];
      for (let x = 0; x < this.width; x++) {
        let type = "tierra";

        let scale = CONSTANTS.NOISE_SCALE;
        let n = this.noise.noise2D(x * scale, y * scale);

        if (n < CONSTANTS.UMBRAL_AGUA) {
          type = "agua";
        } else if (n > CONSTANTS.UMBRAL_BOSQUE) {
          type = "bosque";
        }

        // El centro siempre es llanura para el campamento base
        let r = CONSTANTS.CAMP_CLEAR_RADIUS;
        if (
          Math.abs(x - this.width / 2) <= r &&
          Math.abs(y - this.height / 2) <= r
        ) {
          type = "tierra";
        }

        row.push({
          type: type,
          wood: type === "bosque" ? CONSTANTS.MADERA_POR_ARBOL : 0,
        });

        let emoji = "🟫";
        if (type === "bosque") emoji = "🌲";
        if (type === "agua") emoji = "💧";

        let text = new PIXI.Text(emoji, { fontSize: this.tileSize * 0.8 });
        text.x = x * this.tileSize;
        text.y = y * this.tileSize;
        this.bgContainer.addChild(text);
        spriteRow.push(text);
      }
      this.grid.push(row);
      this.sprites.push(spriteRow);
    }
  }

  getTileType(x, y) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      return this.grid[y][x].type;
    }
    return null;
  }

  getTile(x, y) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      return this.grid[y][x];
    }
    return null;
  }

  updateTile(x, y, newType) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.grid[y][x].type = newType;
      if (newType === "bosque")
        this.grid[y][x].wood = CONSTANTS.MADERA_POR_ARBOL;
      else this.grid[y][x].wood = 0;

      let emoji = "🟫";
      if (newType === "bosque") emoji = "🌲";
      if (newType === "agua") emoji = "💧";

      this.sprites[y][x].text = emoji;
    }
  }

  findNearestTile(startX, startY, type) {
    let nearest = null;
    let minDist = Infinity;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.grid[y][x].type === type) {
          let dist = Math.abs(startX - x) + Math.abs(startY - y);
          if (dist < minDist) {
            minDist = dist;
            nearest = { x, y };
          }
        }
      }
    }
    return { pos: nearest, distance: minDist };
  }

  isTileEmpty(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    if (this.grid[y][x].type !== "tierra") return false;
    if (window.Sim.housing.casas.some((h) => h.x === x && h.y === y))
      return false;
    if (
      window.Sim.personas.some(
        (p) => p.isAlive() && !p.inHouse && p.x === x && p.y === y,
      )
    )
      return false;
    return true;
  }

  findNearestEmptyTile(startX, startY) {
    if (this.isTileEmpty(startX, startY)) return { x: startX, y: startY };
    let radius = 1;
    while (radius < Math.max(this.width, this.height)) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
            if (this.isTileEmpty(startX + dx, startY + dy)) {
              return { x: startX + dx, y: startY + dy };
            }
          }
        }
      }
      radius++;
    }
    return { x: startX, y: startY };
  }

  findEmptyCampTile(startX, startY) {
    // Preferir tierra; si no hay, bosque/agua (se limpia al terminar la casa).
    // No exige celda sin personas: con cientos apiñados jamás habría sitio.
    let nearest = null;
    let minDist = Infinity;
    let nearestAny = null;
    let minDistAny = Infinity;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let occupied = window.Sim.housing.casas.some(
          (h) => h.x === x && h.y === y,
        );
        if (occupied) continue;

        // Chebyshev ≤ 1 = misma celda o 8 vecinos
        let tooClose = false;
        for (let h of window.Sim.housing.casas) {
          let dx = Math.abs(h.x - x);
          let dy = Math.abs(h.y - y);
          if (Math.max(dx, dy) <= 1) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        let dist = Math.abs(startX - x) + Math.abs(startY - y);
        if (dist < minDistAny) {
          minDistAny = dist;
          nearestAny = { x, y };
        }
        if (this.grid[y][x].type === 'tierra' && dist < minDist) {
          minDist = dist;
          nearest = { x, y };
        }
      }
    }
    let pick = nearest || nearestAny;
    return pick
      ? { x: pick.x, y: pick.y, distance: nearest ? minDist : minDistAny }
      : null;
  }

  countTilesInRadius(x, y, radius, type) {
    let count = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        let nx = x + dx;
        let ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          if (this.grid[ny][nx].type === type) count++;
        }
      }
    }
    return count;
  }

  tickEcosystem() {
    // Escanear el mapa y tener una pequeña probabilidad de esparcir bosque
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.grid[y][x].type === "bosque") {
          if (window.RNG.next() < CONSTANTS.PROB_ESPALIR_BOSQUE) {
            // Elegir vecino al azar
            let dirs = [
              [0, 1],
              [1, 0],
              [0, -1],
              [-1, 0],
            ];
            let d = dirs[Math.floor(window.RNG.next() * dirs.length)];
            let nx = x + d[0];
            let ny = y + d[1];
            if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
              if (this.grid[ny][nx].type === "tierra") {
                // Check if house exists there
                let hasHouse = window.Sim.housing.casas.some(
                  (h) => h.x === nx && h.y === ny,
                );
                if (!hasHouse) {
                  this.updateTile(nx, ny, "bosque");
                }
              }
            }
          }
        }
      }
    }
  }

  updatePersonPosition(person) {
    if (!person.isAlive()) {
      if (this.personSprites.has(person.id)) {
        let s = this.personSprites.get(person.id);
        s.text = "💀";
        s.alpha = 0.5;
        s.visible = true;
      }
      return;
    }

    if (!this.personSprites.has(person.id)) {
      let emoji =
        person.getEtapa() === "bebe" ? "👶" : person.sexo === "M" ? "👨" : "👩";
      let sprite = new PIXI.Text(emoji, { fontSize: this.tileSize * 0.7 });
      this.entitiesContainer.addChild(sprite);
      this.personSprites.set(person.id, sprite);
    }

    let sprite = this.personSprites.get(person.id);
    let emoji =
      person.getEtapa() === "bebe" ? "👶" : person.sexo === "M" ? "👨" : "👩";
    if (sprite.text !== emoji) sprite.text = emoji;

    if (person.inHouse) {
      sprite.visible = false;
      return;
    } else {
      sprite.visible = true;
    }

    sprite.style.fontSize = this.tileSize * 0.7;
    sprite.x = person.x * this.tileSize;
    sprite.y = person.y * this.tileSize;
  }

  updateHouses(casas) {
    for (let casa of casas) {
      if (!this.houseSprites.has(casa.id)) {
        let sprite = new PIXI.Text("🏠", { fontSize: this.tileSize * 0.8 });
        sprite.x = casa.x * this.tileSize;
        sprite.y = casa.y * this.tileSize;
        this.entitiesContainer.addChild(sprite);
        this.houseSprites.set(casa.id, sprite);
      }
    }
  }
}

window.SimulationMap = SimulationMap;
