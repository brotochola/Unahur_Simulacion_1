export class UpdateSystem {
  static targets = [];
  static _registered = false;

  static update(dt) {
    const targets = this.targets;
    for (let i = 0; i < targets.length; i++) {
      this.updatePool(targets[i], dt);
    }
  }

  static updatePool(pool, dt) {}
}
