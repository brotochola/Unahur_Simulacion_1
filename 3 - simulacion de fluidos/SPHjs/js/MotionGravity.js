const STANDARD_GRAVITY = 9.80665;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Requests motion permission from a user gesture and turns the accelerometer's
 * proper-acceleration vector into CSS-screen gravity coordinates.
 */
export default class MotionGravity {
  constructor({ onGravity, onState } = {}) {
    this.onGravity = onGravity || (() => {});
    this.onState = onState || (() => {});
    this.secureContext = window.isSecureContext;
    this.mobileDevice = (
      window.matchMedia("(pointer: coarse)").matches
      || navigator.maxTouchPoints > 0
    );
    this.supported = "DeviceMotionEvent" in window;
    this.enabled = false;
    this.receiving = false;
    this.filteredX = 0;
    this.filteredY = 1;
    this.readingTimeout = 0;

    this._handleMotion = this._handleMotion.bind(this);
  }

  get shouldPrompt() {
    return this.mobileDevice;
  }

  async enable() {
    if (!this.secureContext) {
      this.onState(
        "error",
        "Phone browsers block IMU access on plain HTTP. Use an HTTPS URL.",
      );
      return false;
    }

    if (!this.supported) {
      this.onState("unsupported", "Motion sensors are not available in this browser.");
      return false;
    }

    try {
      const requestPermission = window.DeviceMotionEvent?.requestPermission;
      if (typeof requestPermission === "function") {
        const permission = await requestPermission.call(window.DeviceMotionEvent);
        if (permission !== "granted") {
          this.onState(
            "denied",
            "Motion access was declined. You can allow it later in browser settings.",
          );
          return false;
        }
      }

      window.addEventListener("devicemotion", this._handleMotion, {
        passive: true,
      });
      this.enabled = true;
      this.receiving = false;
      this.onState("waiting", "Motion permission granted — waiting for the sensor.");

      window.clearTimeout(this.readingTimeout);
      this.readingTimeout = window.setTimeout(() => {
        if (this.enabled && !this.receiving) {
          this.onState(
            "error",
            "Permission was granted, but this browser has not sent motion data.",
          );
        }
      }, 2800);
      return true;
    } catch (error) {
      const message = error?.name === "NotAllowedError"
        ? "Motion permission must be requested from this button."
        : "Could not start motion gravity on this device.";
      this.onState("error", message);
      return false;
    }
  }

  disable() {
    window.removeEventListener("devicemotion", this._handleMotion);
    window.clearTimeout(this.readingTimeout);
    this.enabled = false;
    this.receiving = false;
    this.filteredX = 0;
    this.filteredY = 1;
    this.onGravity(0, 1);
    this.onState("disabled", "Motion gravity is off.");
  }

  _handleMotion(event) {
    const acceleration = event.accelerationIncludingGravity;
    const rawX = acceleration?.x;
    const rawY = acceleration?.y;

    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
      return;
    }

    // Device axes stay attached to the phone's natural orientation, even when
    // the viewport rotates. ScreenOrientation.angle supplies that rotation.
    const orientationAngle = Number.isFinite(screen.orientation?.angle)
      ? screen.orientation.angle
      : Number(window.orientation) || 0;
    const radians = orientationAngle * Math.PI / 180;
    const sine = Math.sin(radians);
    const cosine = Math.cos(radians);

    // Mobile browsers report accelerationIncludingGravity in the direction
    // the phone is being pulled. Rotate device axes into CSS x/right, y/down.
    let screenX = (rawX * cosine - rawY * sine) / STANDARD_GRAVITY;
    let screenY = (-rawX * sine - rawY * cosine) / STANDARD_GRAVITY;
    const magnitude = Math.hypot(screenX, screenY);

    if (magnitude > 1) {
      screenX /= magnitude;
      screenY /= magnitude;
    }
    if (Math.abs(screenX) < 0.018) {
      screenX = 0;
    }
    if (Math.abs(screenY) < 0.018) {
      screenY = 0;
    }

    const interval = clamp(Number(event.interval) || 16.7, 8, 100) / 1000;
    // A short filter removes accelerometer chatter without making the water
    // feel as if it is following the phone in slow motion.
    const blend = 1 - Math.exp(-interval / 0.075);
    this.filteredX += (screenX - this.filteredX) * blend;
    this.filteredY += (screenY - this.filteredY) * blend;
    this.onGravity(this.filteredX, this.filteredY);

    if (!this.receiving) {
      this.receiving = true;
      window.clearTimeout(this.readingTimeout);
      this.onState("active", "Motion gravity is active.");
    }
  }
}
