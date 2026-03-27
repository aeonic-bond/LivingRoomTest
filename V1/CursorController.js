/**
 * CursorController
 *
 * Manages mouse tracking and raycasting.
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

    // Optional references
    this.transform = null;
    this.sceneCtrl = null;

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

    // Check if hovering over a draggable item
    if (this.transform && !this.transform.dragging) {
      const hitItem = this.transform._hitTest(hit.x, hit.z);
      if (hitItem) {
        const config = FURNITURE[hitItem.type];
        if (config) {
          this._setCursor('default');
          if (this.sceneCtrl) this.sceneCtrl.hoverItem(hitItem.id);
          if (this.hovering) this._hide();
          return;
        }
      }
    }

    // Clear hover highlight when not over an item
    if (this.sceneCtrl) this.sceneCtrl.unhoverItem();
    this._setCursor('');

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

  _onMouseLeave() {
    this._hide();
    this._setCursor('');
    if (this.sceneCtrl) this.sceneCtrl.unhoverItem();
  }

  _hide() {
    if (!this.hovering) return;
    this.hovering = false;
    if (!this.pulse.anchored) {
      this.pulse.stop();
    }
  }

  /**
   * Set cursor style (skipped during active drag).
   */
  _setCursor(style) {
    if (this.transform && this.transform.dragging) return;
    this.canvas.style.cursor = style;
  }

  /** Wire up TransformController after both are created. */
  setTransform(transform) {
    this.transform = transform;
  }

  /** Wire up SceneController for hover highlights. */
  setSceneCtrl(sceneCtrl) {
    this.sceneCtrl = sceneCtrl;
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
