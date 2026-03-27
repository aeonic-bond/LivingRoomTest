/**
 * CameraController
 *
 * Single owner of camera position and zoom.
 * Nothing else should touch camera.position or camera.zoom directly.
 */
class CameraController {
  /**
   * @param {THREE.OrthographicCamera} camera
   * @param {HTMLElement} container
   * @param {Object} defaults - the home state
   * @param {number} defaults.zoom
   * @param {number} defaults.x
   * @param {number} defaults.z
   */
  constructor(camera, container, defaults) {
    this.camera    = camera;
    this.container = container;
    this.defaults  = { ...defaults };
    this.activeCamera = camera;
    this._perspective = false;

    this._apply(this.defaults);
  }

  /** Snap to the default state. */
  toDefault() {
    this._apply(this.defaults);
  }

  /** Recalculate frustum on resize. */
  resize(frustumSize) {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w <= 0 || h <= 0) return;

    const a = w / h;
    this.camera.left   = -frustumSize * a / 2;
    this.camera.right  =  frustumSize * a / 2;
    this.camera.top    =  frustumSize / 2;
    this.camera.bottom = -frustumSize / 2;
    this.camera.updateProjectionMatrix();

    if (this._perspCam) {
      this._perspCam.aspect = a;
      this._perspCam.updateProjectionMatrix();
    }
  }

  /**
   * Toggle between top-down ortho and orbiting perspective view.
   * Drag left/right to orbit around the room center.
   */
  togglePerspective() {
    this._perspective = !this._perspective;
    const cx = this.defaults.x;
    const cz = this.defaults.z;

    if (this._perspective) {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (!this._perspCam) {
        this._perspCam = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
      }

      this._orbitAngle = Math.PI * 0.25;
      this._orbitRadius = 22;
      this._orbitHeight = 12;
      this._orbitCenter = { x: cx, z: cz };
      this._orbitSpeed = 0.005;
      this._orbitDragging = false;
      this._orbitLastX = 0;

      this._updateOrbitCamera();
      this.activeCamera = this._perspCam;

      this._onOrbitKey = (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
          this._orbitAngle -= 0.05;
          this._updateOrbitCamera();
        } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
          this._orbitAngle += 0.05;
          this._updateOrbitCamera();
        }
      };
      document.addEventListener('keydown', this._onOrbitKey);
    } else {
      if (this._onOrbitKey) {
        document.removeEventListener('keydown', this._onOrbitKey);
      }
      this._apply(this.defaults);
      this.activeCamera = this.camera;
    }

    return this.activeCamera;
  }

  _updateOrbitCamera() {
    const c = this._orbitCenter;
    const x = c.x + Math.cos(this._orbitAngle) * this._orbitRadius;
    const z = c.z + Math.sin(this._orbitAngle) * this._orbitRadius;
    this._perspCam.position.set(x, this._orbitHeight, z);
    this._perspCam.lookAt(c.x, 0, c.z);
  }

  /** Get the currently active camera. */
  getCamera() {
    return this.activeCamera || this.camera;
  }

  /** Apply a state to the camera immediately. */
  _apply(state) {
    this._perspective = false;
    this.camera.zoom       = state.zoom;
    this.camera.position.x = state.x;
    this.camera.position.z = state.z;
    this.camera.position.y = 20;
    this.camera.lookAt(state.x, 0, state.z);
    this.camera.up.set(0, 0, -1);
    this.camera.updateProjectionMatrix();
  }
}
