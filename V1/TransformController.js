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
   * @param {EdgeAffinity} edges
   * @param {CornerAffinity} corners
   */
  constructor(canvas, camera, room, sceneData, sceneCtrl, state, edges, corners) {
    this.canvas    = canvas;
    this.camera    = camera;
    this.room      = room;
    this.sceneData = sceneData;
    this.sceneCtrl = sceneCtrl;
    this.state     = state;
    this.edges     = edges;
    this.corners   = corners;

    // Drag state
    this.dragging    = false;
    this.didDrag     = false;
    this.dragItemId  = null;
    this._reorientCooldown = 0;  // seconds remaining before next reorient allowed
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
    this.softMax = 0.5;           // max overshoot in units (lower = more resistance)
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

  /**
   * Compute movement bounds for an item based on room edges and edge affinity zone.
   */
  _getBounds(item) {
    const config = FURNITURE[item.type];
    const fp = config.footprint;

    let extLeft, extRight, extUp, extDown;
    if (fp.type === 'L') {
      // L-shape: asymmetric extents from hinge center
      const h = fp.hinge;
      const sx = item.sx || 1;
      const sz = item.sz || 1;

      const majorTotal = h.w + fp.majorThrust;
      const minorTotal = h.d + fp.minorThrust;

      // Canonical (sx=+1): major arm goes right, hinge extends left by h.w/2
      // Canonical (sz=+1): minor arm goes down, hinge extends up by h.d/2
      if (sx > 0) {
        extRight = majorTotal - h.w / 2;
        extLeft  = h.w / 2;
      } else {
        extLeft  = majorTotal - h.w / 2;
        extRight = h.w / 2;
      }
      if (sz > 0) {
        extDown = minorTotal - h.d / 2;
        extUp   = h.d / 2;
      } else {
        extUp   = minorTotal - h.d / 2;
        extDown = h.d / 2;
      }
    } else {
      const cosR = Math.abs(Math.cos(item.rotation || 0));
      const sinR = Math.abs(Math.sin(item.rotation || 0));
      const hw = (fp.w * cosR + fp.d * sinR) / 2;
      const hd = (fp.w * sinR + fp.d * cosR) / 2;
      extLeft = hw; extRight = hw;
      extUp = hd; extDown = hd;
    }

    // Room edge bounds (asymmetric for L-shapes)
    let minX = extLeft;
    let maxX = this.room.width - extRight;
    let minZ = extUp;
    let maxZ = this.room.height - extDown;

    // Edge-affinity: tighter bounds on the depth axis
    if (config.affinity === 'edge' && item.edgeId != null) {
      const edge = this.edges.getEdge(item.edgeId);
      if (edge) {
        if (Math.abs(edge.normal.z) > Math.abs(edge.normal.x)) {
          const edgeZ = (edge.z1 + edge.z2) / 2;
          const zoneLimit = edgeZ + edge.normal.z * edge.zoneDepth;
          if (edge.normal.z > 0) {
            minZ = Math.max(minZ, edgeZ + extUp);
            maxZ = Math.min(maxZ, zoneLimit - extDown);
          } else {
            minZ = Math.max(minZ, zoneLimit + extUp);
            maxZ = Math.min(maxZ, edgeZ - extDown);
          }
        } else {
          const edgeX = (edge.x1 + edge.x2) / 2;
          const zoneLimit = edgeX + edge.normal.x * edge.zoneDepth;
          if (edge.normal.x > 0) {
            minX = Math.max(minX, edgeX + extLeft);
            maxX = Math.min(maxX, zoneLimit - extRight);
          } else {
            minX = Math.max(minX, zoneLimit + extLeft);
            maxX = Math.min(maxX, edgeX - extRight);
          }
        }
      }
    }

    // Corner-affinity: zone from CornerAffinity
    if (config.affinity === 'corner' && item.cornerId != null && this.corners) {
      const zone = this.corners.getZone(item.cornerId, FURNITURE[item.type].footprint);
      minX = Math.max(minX, zone.minX + extLeft);
      maxX = Math.min(maxX, zone.maxX - extRight);
      minZ = Math.max(minZ, zone.minZ + extUp);
      maxZ = Math.min(maxZ, zone.maxZ - extDown);
    }

    return { minX, maxX, minZ, maxZ };
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    if (!this.state.is(STATES.DEFAULT) && !this.state.is(STATES.SELECTED)) return;

    const pos = this._getWorldPos(e);
    if (!pos) return;

    const item = this._hitTest(pos.x, pos.z);
    if (!item) return;

    const config = FURNITURE[item.type];

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
      const dragItem = this.sceneData.get(this.dragItemId);
      this._lastValidX = dragItem ? dragItem.x : 0;
      this._lastValidZ = dragItem ? dragItem.z : 0;
      this.state.set(STATES.TRANSFORM);
      this.canvas.style.cursor = 'grabbing';
      // Show zone
      if (dragItem) this._showItemZone(dragItem);
    }

    const item = this.sceneData.get(this.dragItemId);
    if (!item) return;

    // Target position with grab offset
    const rawX = pos.x + this.grabOffsetX;
    const rawZ = pos.z + this.grabOffsetZ;

    let bounds = this._getBounds(item);

    // Check for hard reorientation (edge-affinity items only)
    const config = FURNITURE[item.type];
    if (config.affinity === 'edge' && item.edgeId != null) {
      const rawOverX = rawX < bounds.minX ? bounds.minX - rawX :
                       rawX > bounds.maxX ? rawX - bounds.maxX : 0;
      const rawOverZ = rawZ < bounds.minZ ? bounds.minZ - rawZ :
                       rawZ > bounds.maxZ ? rawZ - bounds.maxZ : 0;
      const rawOver = Math.max(rawOverX, rawOverZ);

      if (rawOver > 1.5 && this._reorientCooldown <= 0) {
        // Overshoot direction vector
        const overDirX = rawX < bounds.minX ? -1 : rawX > bounds.maxX ? 1 : 0;
        const overDirZ = rawZ < bounds.minZ ? -1 : rawZ > bounds.maxZ ? 1 : 0;

        // Find the edge the item is moving toward
        // The target edge's normal opposes the overshoot direction
        // (you drag toward a wall, that wall's normal points back at you)
        let newEdge = null;
        let bestDot = Infinity;
        for (const edge of this.edges.edges) {
          const dot = overDirX * edge.normal.x + overDirZ * edge.normal.z;
          if (dot < bestDot) {
            bestDot = dot;
            newEdge = edge;
          }
        }
        if (newEdge && newEdge.id !== item.edgeId) {
          // Preview: check if reoriented position would collide
          const newRotation = this.edges.getRotation(newEdge);
          const tempItem = { ...item, edgeId: newEdge.id, rotation: newRotation };
          const newBounds = this._getBounds(tempItem);
          const testX = Math.max(newBounds.minX, Math.min(newBounds.maxX, rawX));
          const testZ = Math.max(newBounds.minZ, Math.min(newBounds.maxZ, rawZ));
          const wouldCollide = Collision.findOverlaps(item.type, testX, testZ, tempItem, this.sceneData, item.id);

          if (wouldCollide.length > 0) {
            // Collision at new orientation — block reorient
          } else {
          this.sceneData.update(item.id, {
            edgeId: newEdge.id,
            rotation: newRotation,
          });
          // Update the 3D mesh rotation
          const mesh = this.sceneCtrl.meshes[item.id];
          if (mesh) mesh.rotation.y = newRotation;
          // Cooldown before next reorient
          this._reorientCooldown = 1.0;
          // Recalculate bounds for the new edge
          bounds = this._getBounds(item);
          // Reset last valid to current clamped position (with collision check)
          let newX = Math.max(bounds.minX, Math.min(bounds.maxX, rawX));
          let newZ = Math.max(bounds.minZ, Math.min(bounds.maxZ, rawZ));
          const reorientOverlaps = Collision.findOverlaps(item.type, newX, newZ, item, this.sceneData, item.id);
          if (reorientOverlaps.length > 0) {
            // Colliding at new position — push away from collider
            const gap = 0.25;
            const other = reorientOverlaps[0];
            const dx = newX - other.x;
            const dz = newZ - other.z;
            const dist = Math.sqrt(dx * dx + dz * dz) || 1;
            newX += (dx / dist) * gap;
            newZ += (dz / dist) * gap;
            newX = Math.max(bounds.minX, Math.min(bounds.maxX, newX));
            newZ = Math.max(bounds.minZ, Math.min(bounds.maxZ, newZ));
          }
          this._lastValidX = newX;
          this._lastValidZ = newZ;
          // Update zone highlight
          this._showItemZone(item);
          }
        }
      }
    }

    // Corner affinity reorientation — proximity to adjacent corners (ignores room edges)
    if (config.affinity === 'corner' && item.cornerId != null && this.corners && this._reorientCooldown <= 0) {
      const currentCorner = this.corners.getCorner(item.cornerId);
      const curDx = rawX - currentCorner.x;
      const curDz = rawZ - currentCorner.z;
      const curDist = Math.sqrt(curDx * curDx + curDz * curDz);

      // Check overshoot against bounds (same as edge affinity pattern)
      const rawOverX = rawX < bounds.minX ? bounds.minX - rawX :
                       rawX > bounds.maxX ? rawX - bounds.maxX : 0;
      const rawOverZ = rawZ < bounds.minZ ? bounds.minZ - rawZ :
                       rawZ > bounds.maxZ ? rawZ - bounds.maxZ : 0;
      const rawOver = Math.max(rawOverX, rawOverZ);

      let newCorner = null;
      if (rawOver > 1.5) {
        const overDirX = rawX < bounds.minX ? -1 : rawX > bounds.maxX ? 1 : 0;
        const overDirZ = rawZ < bounds.minZ ? -1 : rawZ > bounds.maxZ ? 1 : 0;

        // Only trigger if overshoot direction points away from the corner (toward interior)
        // Corner normal points toward interior, so positive dot = toward interior
        const dot = overDirX * currentCorner.normal.x + overDirZ * currentCorner.normal.z;
        if (dot > 0) {
          let bestCornerDot = Infinity;
          for (const corner of this.corners.corners) {
            if (corner.id === item.cornerId) continue;
            const shared = corner.edgeIds.some(id => currentCorner.edgeIds.includes(id));
            if (!shared) continue;

            const d = overDirX * corner.normal.x + overDirZ * corner.normal.z;
            if (d < bestCornerDot) {
              bestCornerDot = d;
              newCorner = corner;
            }
          }
        }
      }

      if (newCorner) {
        const newSx = newCorner.normal.x > 0 ? 1 : -1;
        const newSz = newCorner.normal.z > 0 ? 1 : -1;

        // Check collision at new orientation
        const tempItem = { ...item, cornerId: newCorner.id, sx: newSx, sz: newSz };
        const testOverlaps = Collision.findOverlaps(item.type, rawX, rawZ, tempItem, this.sceneData, item.id);

        if (testOverlaps.length === 0) {
          // Compute visual bbox shift compensation
          const cfp = config.footprint;
          const ch = cfp.hinge;
          const oldSxVal = currentCorner.normal.x > 0 ? 1 : -1;
          const oldSzVal = currentCorner.normal.z > 0 ? 1 : -1;
          const majT = ch.w + cfp.majorThrust;
          const minT = ch.d + cfp.minorThrust;

          const oldBboxCX = (majT / 2 - ch.w / 2) * oldSxVal;
          const oldBboxCZ = (minT / 2 - ch.d / 2) * oldSzVal;
          const newBboxCX = (majT / 2 - ch.w / 2) * newSx;
          const newBboxCZ = (minT / 2 - ch.d / 2) * newSz;

          // Apply reorientation
          this.sceneData.update(item.id, {
            cornerId: newCorner.id,
            sx: newSx,
            sz: newSz,
          });
          const mesh = this.sceneCtrl.meshes[item.id];
          if (mesh) mesh.scale.set(newSx, 1, newSz);
          this._reorientCooldown = 1.0;

          // Keep visual bbox stable — compensate for hinge-to-bbox-center shift
          let newX = item.x - (newBboxCX - oldBboxCX);
          let newZ = item.z - (newBboxCZ - oldBboxCZ);

          const newBounds = this._getBounds(item);
          newX = Math.max(newBounds.minX, Math.min(newBounds.maxX, newX));
          newZ = Math.max(newBounds.minZ, Math.min(newBounds.maxZ, newZ));

          this.sceneData.update(item.id, { x: newX, z: newZ });
          bounds = newBounds;
          this._lastValidX = newX;
          this._lastValidZ = newZ;
          // Update grab offset so drag continues from new position
          this.grabOffsetX = newX - pos.x;
          this.grabOffsetZ = newZ - pos.z;
          this._showItemZone(item);
        }
      }
    }

    // Soft bounds
    let x = this.softBounds(rawX, bounds.minX, bounds.maxX);
    let z = this.softBounds(rawZ, bounds.minZ, bounds.maxZ);

    // Check collision with other items
    const overlaps = Collision.findOverlaps(item.type, x, z, item, this.sceneData, item.id);

    if (overlaps.length === 0) {
      // No collision — update position and store as last valid
      this._lastValidX = x;
      this._lastValidZ = z;
      this.sceneData.update(item.id, { x, z });
    } else {
      // Collision — apply soft bounds relative to last valid position
      const dx = x - this._lastValidX;
      const dz = z - this._lastValidZ;
      const softX = this._lastValidX + this.softBounds(dx, -this.softMax, this.softMax);
      const softZ = this._lastValidZ + this.softBounds(dz, -this.softMax, this.softMax);
      this.sceneData.update(item.id, { x: softX, z: softZ });
    }
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
    this.sceneCtrl.hideZone();

    // Bounce back if outside valid bounds or colliding
    if (item) {
      const { minX, maxX, minZ, maxZ } = this._getBounds(item);

      // Clamp to bounds
      let endX = Math.max(minX, Math.min(maxX, item.x));
      let endZ = Math.max(minZ, Math.min(maxZ, item.z));

      // If still colliding after clamp, bounce to last valid position + gap
      const overlaps = Collision.findOverlaps(item.type, endX, endZ, item, this.sceneData, item.id);
      if (overlaps.length > 0) {
        const gap = 0.25;
        const other = overlaps[0];
        const dx = this._lastValidX - other.x;
        const dz = this._lastValidZ - other.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 1;
        endX = this._lastValidX + (dx / dist) * gap;
        endZ = this._lastValidZ + (dz / dist) * gap;

        endX = Math.max(minX, Math.min(maxX, endX));
        endZ = Math.max(minZ, Math.min(maxZ, endZ));
      }

      if (item.x !== endX || item.z !== endZ) {
        this._bounceAnim = {
          itemId:   item.id,
          startX:   item.x,
          startZ:   item.z,
          endX:     endX,
          endZ:     endZ,
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
    if (this._reorientCooldown > 0) this._reorientCooldown -= dt;

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

  /**
   * Show the movement zone for an item.
   */
  _showItemZone(item) {
    const config = FURNITURE[item.type];
    if (!config) return;

    if (config.affinity === 'none') {
      // Full room
      this.sceneCtrl.showZone(0, 0, this.room.width, this.room.height);
    } else if (config.affinity === 'edge' && item.edgeId != null) {
      const edge = this.edges.getEdge(item.edgeId);
      if (!edge) return;

      if (Math.abs(edge.normal.z) > Math.abs(edge.normal.x)) {
        const edgeZ = (edge.z1 + edge.z2) / 2;
        const zoneLimit = edgeZ + edge.normal.z * edge.zoneDepth;
        const z0 = Math.min(edgeZ, zoneLimit);
        const z1 = Math.max(edgeZ, zoneLimit);
        this.sceneCtrl.showZone(0, z0, this.room.width, z1);
      } else {
        const edgeX = (edge.x1 + edge.x2) / 2;
        const zoneLimit = edgeX + edge.normal.x * edge.zoneDepth;
        const x0 = Math.min(edgeX, zoneLimit);
        const x1 = Math.max(edgeX, zoneLimit);
        this.sceneCtrl.showZone(x0, 0, x1, this.room.height);
      }
    } else if (config.affinity === 'corner' && item.cornerId != null && this.corners) {
      const zone = this.corners.getZone(item.cornerId, FURNITURE[item.type].footprint);
      this.sceneCtrl.showZone(zone.minX, zone.minZ, zone.maxX, zone.maxZ);
    }
  }
}
