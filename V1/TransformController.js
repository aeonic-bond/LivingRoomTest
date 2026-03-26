/**
 * TransformController
 *
 * Handles drag-to-move for placed furniture items.
 * Works in DEFAULT state — no selection needed.
 * Grid-snaps movement, maintains grab offset (no jumping).
 */
class TransformController {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {THREE.OrthographicCamera} camera
   * @param {Object} room
   * @param {SceneData} sceneData
   * @param {SceneController} sceneCtrl
   * @param {StateController} state
   */
  constructor(canvas, camera, room, sceneData, sceneCtrl, state) {
    this.canvas    = canvas;
    this.camera    = camera;
    this.room      = room;
    this.sceneData = sceneData;
    this.sceneCtrl = sceneCtrl;
    this.state     = state;

    // Drag state
    this.dragging    = false;
    this.didDrag     = false;
    this.dragItemId  = null;
    this.grabOffsetX = 0;
    this.grabOffsetZ = 0;

    // Raycasting
    this.raycaster   = new THREE.Raycaster();
    this.mouse       = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp   = this._onMouseUp.bind(this);

    // Soft bounds config
    this.softMax = 0.75;          // max overshoot in units (lower = more resistance)
    this._bounceAnim = null;      // { item, startX, startZ, endX, endZ, elapsed, duration }

    this.canvas.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  /**
   * Apply soft bounds to a value. Allows overshoot past a limit
   * with diminishing returns, up to softMax.
   * @param {number} value - the raw position
   * @param {number} min - hard minimum
   * @param {number} max - hard maximum
   * @returns {number} soft-clamped value
   */
  softBounds(value, min, max) {
    if (value >= min && value <= max) return value;

    const limit = this.softMax;
    if (value < min) {
      const over = min - value;
      const damped = limit * (1 - 1 / (1 + over / limit));
      return min - damped;
    } else {
      const over = value - max;
      const damped = limit * (1 - 1 / (1 + over / limit));
      return max + damped;
    }
  }

  _getWorldPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return hit;
    return null;
  }

  /**
   * Find which item the point hits by checking against scene meshes.
   */
  _hitTest(worldX, worldZ) {
    for (const item of this.sceneData.items) {
      const config = FURNITURE[item.type];
      if (!config) continue;

      const fp = config.footprint;
      if (fp.type === 'L') {
        // L-shape hit test using blocks relative to item position
        if (this._hitTestL(worldX, worldZ, item, config)) return item;
      } else {
        // Rect hit test
        const halfW = fp.w / 2;
        const halfD = fp.d / 2;
        // Account for rotation: for edge-affinity items, w/d may be swapped
        const cosR = Math.abs(Math.cos(item.rotation || 0));
        const sinR = Math.abs(Math.sin(item.rotation || 0));
        const extX = (fp.w * cosR + fp.d * sinR) / 2;
        const extZ = (fp.w * sinR + fp.d * cosR) / 2;

        if (Math.abs(worldX - item.x) <= extX && Math.abs(worldZ - item.z) <= extZ) {
          return item;
        }
      }
    }
    return null;
  }

  _hitTestL(worldX, worldZ, item, config) {
    const fp = config.footprint;
    const h = fp.hinge;
    const sx = item.sx || 1;
    const sz = item.sz || 1;

    // Hinge block (centered on item position)
    const hx0 = item.x - h.w / 2 * sx;
    const hz0 = item.z - h.d / 2 * sz;

    // Check hinge
    const hingeMinX = Math.min(hx0, hx0 + h.w * sx);
    const hingeMaxX = Math.max(hx0, hx0 + h.w * sx);
    const hingeMinZ = Math.min(hz0, hz0 + h.d * sz);
    const hingeMaxZ = Math.max(hz0, hz0 + h.d * sz);
    if (worldX >= hingeMinX && worldX <= hingeMaxX && worldZ >= hingeMinZ && worldZ <= hingeMaxZ) return true;

    // Major arm
    const majorX0 = hx0;
    const majorZ0 = hz0;
    const majorW = (h.w + fp.majorThrust) * sx;
    const majorD = h.d * sz;
    const majMinX = Math.min(majorX0, majorX0 + majorW);
    const majMaxX = Math.max(majorX0, majorX0 + majorW);
    const majMinZ = Math.min(majorZ0, majorZ0 + majorD);
    const majMaxZ = Math.max(majorZ0, majorZ0 + majorD);
    if (worldX >= majMinX && worldX <= majMaxX && worldZ >= majMinZ && worldZ <= majMaxZ) return true;

    // Minor arm
    const minorX0 = hx0;
    const minorZ0 = hz0 + h.d * sz;
    const minorW = h.w * sx;
    const minorD = fp.minorThrust * sz;
    const minMinX = Math.min(minorX0, minorX0 + minorW);
    const minMaxX = Math.max(minorX0, minorX0 + minorW);
    const minMinZ = Math.min(minorZ0, minorZ0 + minorD);
    const minMaxZ = Math.max(minorZ0, minorZ0 + minorD);
    if (worldX >= minMinX && worldX <= minMaxX && worldZ >= minMinZ && worldZ <= minMaxZ) return true;

    return false;
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    if (!this.state.is(STATES.DEFAULT) && !this.state.is(STATES.SELECTED)) return;

    const pos = this._getWorldPos(e);
    if (!pos) return;

    const item = this._hitTest(pos.x, pos.z);
    if (!item) return;

    // Only interact with no-affinity items for now
    const config = FURNITURE[item.type];
    if (config.affinity !== 'none') return;

    // Start pending drag — don't enter TRANSFORM until mouse moves
    this._pending = true;
    this._pendingItemId = item.id;
    this._pendingStartX = pos.x;
    this._pendingStartZ = pos.z;
    this.grabOffsetX = item.x - pos.x;
    this.grabOffsetZ = item.z - pos.z;
    this._prevState = this.state.current;
  }

  _onMouseMove(e) {
    if (!this.dragging && !this._pending) return;

    const pos = this._getWorldPos(e);
    if (!pos) return;

    // Promote pending to dragging after movement threshold
    if (this._pending && !this.dragging) {
      const dx = pos.x - this._pendingStartX;
      const dz = pos.z - this._pendingStartZ;
      if (dx * dx + dz * dz < 0.1 * 0.1) return; // threshold: 0.1 units

      this.dragging = true;
      this.didDrag = false;
      this.dragItemId = this._pendingItemId;
      this._pending = false;
      this.state.set(STATES.TRANSFORM);
      this.canvas.style.cursor = 'grabbing';
    }

    const item = this.sceneData.get(this.dragItemId);
    if (!item) return;

    const config = FURNITURE[item.type];
    const fp = config.footprint;
    const halfW = fp.w / 2;
    const halfD = fp.d / 2;

    // Target position with grab offset
    const rawX = pos.x + this.grabOffsetX;
    const rawZ = pos.z + this.grabOffsetZ;

    // Soft bounds — allows slight overshoot with resistance
    const x = this.softBounds(rawX, halfW, this.room.width - halfW);
    const z = this.softBounds(rawZ, halfD, this.room.height - halfD);

    this.sceneData.update(item.id, { x, z });
  }

  _onMouseUp() {
    // Click (no drag) — select the item
    if (this._pending && !this.dragging) {
      this._pending = false;
      this.didDrag = true; // prevent click handler from firing
      this.state.set(STATES.SELECTED, { itemId: this._pendingItemId });
      return;
    }

    if (!this.dragging) return;

    const item = this.sceneData.get(this.dragItemId);
    this.dragging = false;
    this.didDrag = true;
    this.canvas.style.cursor = '';

    // Bounce back if outside valid bounds
    if (item) {
      const config = FURNITURE[item.type];
      const fp = config.footprint;
      const halfW = fp.w / 2;
      const halfD = fp.d / 2;
      const clampedX = Math.max(halfW, Math.min(this.room.width - halfW, item.x));
      const clampedZ = Math.max(halfD, Math.min(this.room.height - halfD, item.z));

      if (item.x !== clampedX || item.z !== clampedZ) {
        this._bounceAnim = {
          itemId:   item.id,
          startX:   item.x,
          startZ:   item.z,
          endX:     clampedX,
          endZ:     clampedZ,
          elapsed:  0,
          duration: 0.2,
        };
      }
    }

    this.dragItemId = null;

    if (this.state.is(STATES.TRANSFORM)) {
      this.state.set(this._prevState || STATES.DEFAULT);
    }
  }

  /**
   * Call every frame from the render loop.
   * Handles bounce-back animation.
   */
  update(dt) {
    if (!this._bounceAnim) return;

    const b = this._bounceAnim;
    b.elapsed += dt;
    const t = Math.min(1, b.elapsed / b.duration);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

    const x = b.startX + (b.endX - b.startX) * ease;
    const z = b.startZ + (b.endZ - b.startZ) * ease;

    this.sceneData.update(b.itemId, { x, z });

    if (t >= 1) this._bounceAnim = null;
  }
}
