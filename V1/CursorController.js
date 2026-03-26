/**
 * CursorController
 *
 * Manages mouse tracking and raycasting.
 * Delegates pulse visuals (including plus) to PulseController.
 */
class CursorController {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} room
   * @param {HTMLCanvasElement} canvas
   * @param {THREE.OrthographicCamera} camera
   * @param {PulseController} pulse
   */
  constructor(scene, room, canvas, camera, pulse, sceneData) {
    this.scene     = scene;
    this.room      = room;
    this.canvas    = canvas;
    this.camera    = camera;
    this.pulse     = pulse;
    this.sceneData = sceneData;

    // State
    this.enabled  = true;
    this.hovering = false;
    this.centerX  = 0;
    this.centerZ  = 0;

    // Raycasting
    this.raycaster   = new THREE.Raycaster();
    this.mouse       = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Events
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseLeave = this._onMouseLeave.bind(this);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mouseleave', this._onMouseLeave);
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

    // Check if hovering over a placed item
    const overItem = this._hitTestItems(hit.x, hit.z);
    if (overItem) {
      this.canvas.style.cursor = 'grab';
      if (this.hovering) this._hide();
      return;
    }

    this.canvas.style.cursor = '';

    // Snap to center of nearest unit
    const ux = Math.floor(hit.x) + 0.5;
    const uz = Math.floor(hit.z) + 0.5;

    this.centerX = ux;
    this.centerZ = uz;

    if (!this.hovering) {
      this.hovering = true;
      this.pulse.start(ux, uz);
    } else {
      this.pulse.setPosition(ux, uz);
    }
  }

  /**
   * Simple AABB hit test against placed items.
   */
  _hitTestItems(wx, wz) {
    for (const item of this.sceneData.items) {
      const config = FURNITURE[item.type];
      if (!config) continue;

      const fp = config.footprint;
      if (fp.type === 'L') {
        // Simplified L bounding box check
        const h = fp.hinge;
        const sx = item.sx || 1;
        const sz = item.sz || 1;
        const totalW = (h.w + fp.majorThrust) * Math.abs(sx);
        const totalD = (h.d + fp.minorThrust) * Math.abs(sz);
        const minX = Math.min(item.x - h.w/2, item.x - h.w/2 + totalW * sx);
        const maxX = Math.max(item.x - h.w/2, item.x - h.w/2 + totalW * sx);
        const minZ = Math.min(item.z - h.d/2, item.z - h.d/2 + totalD * sz);
        const maxZ = Math.max(item.z - h.d/2, item.z - h.d/2 + totalD * sz);
        if (wx >= minX && wx <= maxX && wz >= minZ && wz <= maxZ) return item;
      } else {
        const cosR = Math.abs(Math.cos(item.rotation || 0));
        const sinR = Math.abs(Math.sin(item.rotation || 0));
        const extX = (fp.w * cosR + fp.d * sinR) / 2;
        const extZ = (fp.w * sinR + fp.d * cosR) / 2;
        if (Math.abs(wx - item.x) <= extX && Math.abs(wz - item.z) <= extZ) return item;
      }
    }
    return null;
  }

  _onMouseLeave() {
    this._hide();
    this.canvas.style.cursor = '';
  }

  _hide() {
    if (!this.hovering) return;
    this.hovering = false;
    this.canvas.style.cursor = '';
    if (!this.pulse.anchored) {
      this.pulse.stop();
    }
  }

  disable() {
    this.enabled = false;
    this.hovering = false;
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
