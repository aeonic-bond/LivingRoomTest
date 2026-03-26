// ── Color tokens (read from globalTokens.css) ────────────────
function cursorCssColor(varName) {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return new THREE.Color(hex);
}
const CURSOR_COLOR_BLACK_BASE = cursorCssColor('--color-black-base');

/**
 * CursorController
 *
 * Manages mouse tracking, raycasting, and the crosshair.
 * Delegates pulse visuals to PulseController.
 */
class CursorController {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} room
   * @param {HTMLCanvasElement} canvas
   * @param {THREE.OrthographicCamera} camera
   * @param {PulseController} pulse
   */
  constructor(scene, room, canvas, camera, pulse) {
    this.scene  = scene;
    this.room   = room;
    this.canvas = canvas;
    this.camera = camera;
    this.pulse  = pulse;

    // Crosshair config
    this.plusColor   = CURSOR_COLOR_BLACK_BASE;
    this.plusOpacity = 0.8;

    // State
    this.enabled  = true;
    this.hovering = false;
    this.centerX  = 0;
    this.centerZ  = 0;

    // Raycasting
    this.raycaster   = new THREE.Raycaster();
    this.mouse       = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Crosshair visual
    this.crosshair = new THREE.Group();
    this.crosshair.visible = false;
    this._buildCrosshair();
    this.scene.add(this.crosshair);

    // Events
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseLeave = this._onMouseLeave.bind(this);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mouseleave', this._onMouseLeave);
  }

  _buildCrosshair() {
    const size = 0.25;
    this.plusMat = new THREE.LineBasicMaterial({
      color: this.plusColor,
      transparent: true,
      opacity: 0,
    });
    const hPts = [new THREE.Vector3(-size, 0, 0), new THREE.Vector3(size, 0, 0)];
    const vPts = [new THREE.Vector3(0, 0, -size), new THREE.Vector3(0, 0, size)];
    this.plusH = new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts), this.plusMat);
    this.plusV = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vPts), this.plusMat);
    this.plusH.position.y = 0.006;
    this.plusV.position.y = 0.006;
    this.crosshair.add(this.plusH);
    this.crosshair.add(this.plusV);
  }

  _onMouseMove(e) {
    if (!this.enabled) return;
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = new THREE.Vector3();
    const intersects = this.raycaster.ray.intersectPlane(this.groundPlane, hit);

    if (!intersects) {
      this._hide();
      return;
    }

    if (hit.x < 0 || hit.x > this.room.width || hit.z < 0 || hit.z > this.room.height) {
      this._hide();
      return;
    }

    // Snap to center of nearest unit
    const ux = Math.floor(hit.x) + 0.5;
    const uz = Math.floor(hit.z) + 0.5;

    this.centerX = ux;
    this.centerZ = uz;

    // Update crosshair position
    this.crosshair.position.x = ux;
    this.crosshair.position.z = uz;

    if (!this.hovering) {
      this.hovering = true;
      this.crosshair.visible = true;
      this.plusMat.opacity = this.plusOpacity;
      this.pulse.start(ux, uz);
    } else {
      this.pulse.setPosition(ux, uz);
    }
  }

  _onMouseLeave() {
    this._hide();
  }

  _hide() {
    if (!this.hovering) return;
    this.hovering = false;
    this.crosshair.visible = false;
    if (!this.pulse.anchored) {
      this.pulse.stop();
    }
  }

  disable() {
    this.enabled = false;
    this.hovering = false;
    this.crosshair.visible = false;
    // Don't touch the pulse — it may be anchored by another controller
  }

  enable() {
    this.enabled = true;
  }

  /** Returns the current snapped grid position. */
  getPosition() {
    return { x: this.centerX, z: this.centerZ };
  }
}
