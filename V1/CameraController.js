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

    this._apply(this.defaults);
  }

  /** Snap to the default state. */
  toDefault() {
    this._apply(this.defaults);
  }

  /** Recalculate ortho frustum on resize. */
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
  }

  /** Apply a state to the camera immediately. */
  _apply(state) {
    this.camera.zoom       = state.zoom;
    this.camera.position.x = state.x;
    this.camera.position.z = state.z;
    this.camera.lookAt(state.x, 0, state.z);
    this.camera.up.set(0, 0, -1);
    this.camera.updateProjectionMatrix();
  }
}
