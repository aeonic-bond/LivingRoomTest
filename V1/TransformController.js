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

    // Overshoot config
    this.overshootMax = 2;        // max visual overshoot (dampened)
    this.reorientThreshold = 1.5; // raw overshoot past bounds to trigger reorient
    this.overshootClamp = 1.6;    // hard limit on raw overshoot distance
    this._bounceAnim = null;

    this.canvas.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  /**
   * Dampen overshoot with diminishing returns (V0 pattern).
   * Returns { value, rawOver, direction }
   * - value: the dampened position
   * - rawOver: how far past the bound in raw space (for reorient check)
   * - direction: -1, 0, or 1
   */
  overshoot(value, min, max) {
    if (value >= min && value <= max) {
      return { value, rawOver: 0, direction: 0 };
    }

    const limit = this.overshootMax;
    const clamp = this.overshootClamp;
    if (value < min) {
      const raw = Math.min(min - value, clamp);
      const damped = limit * (1 - 1 / (1 + raw / limit));
      return { value: min - damped, rawOver: raw, direction: -1 };
    } else {
      const raw = Math.min(value - max, clamp);
      const damped = limit * (1 - 1 / (1 + raw / limit));
      return { value: max + damped, rawOver: raw, direction: 1 };
    }
  }

  _getWorldPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this._camController ? this._camController.getCamera() : this.camera);
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

    // Unified overshoot — dampened elastic + reorientation trigger
    const config = FURNITURE[item.type];
    const oX = this.overshoot(rawX, bounds.minX, bounds.maxX);
    const oZ = this.overshoot(rawZ, bounds.minZ, bounds.maxZ);
    const rawOver = Math.max(oX.rawOver, oZ.rawOver);

    // Reorientation check (if past threshold and cooldown expired)
    if (rawOver > this.reorientThreshold && this._reorientCooldown <= 0) {
      const overDirX = oX.direction;
      const overDirZ = oZ.direction;

      if (config.affinity === 'edge' && item.edgeId != null) {
        // Edge: find edge in overshoot direction
        let newEdge = null;
        let bestDot = Infinity;
        for (const edge of this.edges.edges) {
          const dot = overDirX * edge.normal.x + overDirZ * edge.normal.z;
          if (dot < bestDot) { bestDot = dot; newEdge = edge; }
        }
        if (newEdge && newEdge.id !== item.edgeId) {
          const newRotation = this.edges.getRotation(newEdge);
          const tempItem = { ...item, edgeId: newEdge.id, rotation: newRotation };
          const wouldCollide = Collision.findOverlaps(item.type,
            Math.max(this._getBounds(tempItem).minX, Math.min(this._getBounds(tempItem).maxX, rawX)),
            Math.max(this._getBounds(tempItem).minZ, Math.min(this._getBounds(tempItem).maxZ, rawZ)),
            tempItem, this.sceneData, item.id);

          if (wouldCollide.length === 0) {
            this.sceneData.update(item.id, { edgeId: newEdge.id, rotation: newRotation });
            const mesh = this.sceneCtrl.meshes[item.id];
            if (mesh) mesh.rotation.y = newRotation;
            this._reorientCooldown = 1.0;
            this._hideCenterLine();
            this._hideSlotLine();
            bounds = this._getBounds(item);
            this._lastValidX = Math.max(bounds.minX, Math.min(bounds.maxX, rawX));
            this._lastValidZ = Math.max(bounds.minZ, Math.min(bounds.maxZ, rawZ));
            this.grabOffsetX = this._lastValidX - pos.x;
            this.grabOffsetZ = this._lastValidZ - pos.z;
            this._showItemZone(item);
          }
        }
      } else if (config.affinity === 'corner' && item.cornerId != null && this.corners) {
        // Corner: only trigger toward interior, adjacent corners only
        const currentCorner = this.corners.getCorner(item.cornerId);
        const dot = overDirX * currentCorner.normal.x + overDirZ * currentCorner.normal.z;

        if (dot > 0) {
          let newCorner = null;
          let bestCornerDot = Infinity;
          for (const corner of this.corners.corners) {
            if (corner.id === item.cornerId) continue;
            const shared = corner.edgeIds.some(id => currentCorner.edgeIds.includes(id));
            if (!shared) continue;
            const d = overDirX * corner.normal.x + overDirZ * corner.normal.z;
            if (d < bestCornerDot) { bestCornerDot = d; newCorner = corner; }
          }

          if (newCorner) {
            const newSx = newCorner.normal.x > 0 ? 1 : -1;
            const newSz = newCorner.normal.z > 0 ? 1 : -1;
            const tempItem = { ...item, cornerId: newCorner.id, sx: newSx, sz: newSz };
            const testOverlaps = Collision.findOverlaps(item.type, rawX, rawZ, tempItem, this.sceneData, item.id);

            if (testOverlaps.length === 0) {
              // Use stored center: hinge + centerOff = bbox center
              const oldCenterX = this._lastValidX + item.centerOffX;
              const oldCenterZ = this._lastValidZ + item.centerOffZ;

              // Compute new center offset
              const cfp = config.footprint;
              const ch = cfp.hinge;
              const majT = ch.w + cfp.majorThrust;
              const minT = ch.d + cfp.minorThrust;
              const newCenterOffX = (majT / 2 - ch.w / 2) * newSx;
              const newCenterOffZ = (minT / 2 - ch.d / 2) * newSz;

              // Apply reorientation
              this.sceneData.update(item.id, {
                cornerId: newCorner.id,
                sx: newSx,
                sz: newSz,
                centerOffX: newCenterOffX,
                centerOffZ: newCenterOffZ,
              });
              this._reorientCooldown = 1.0;
              this._hideCenterLine();
              this._hideSlotLine();

              // Derive new hinge from preserved center
              const newHingeX = oldCenterX - newCenterOffX;
              const newHingeZ = oldCenterZ - newCenterOffZ;

              // Clamp to new bounds
              const newBounds = this._getBounds(item);
              const clampedX = Math.max(newBounds.minX, Math.min(newBounds.maxX, newHingeX));
              const clampedZ = Math.max(newBounds.minZ, Math.min(newBounds.maxZ, newHingeZ));

              this.sceneData.update(item.id, { x: clampedX, z: clampedZ });

              // Rebuild mesh
              this.sceneCtrl._removeMesh(item);
              this.sceneCtrl._addMesh(item);

              bounds = newBounds;
              this._lastValidX = clampedX;
              this._lastValidZ = clampedZ;

              // Reset grab offset from cursor to new hinge position
              this.grabOffsetX = clampedX - pos.x;
              this.grabOffsetZ = clampedZ - pos.z;

              this._showItemZone(item);
              return; // skip rest of frame to avoid stale offset artifacts
            }
          }
        }
      }
    }

    // Apply dampened overshoot position
    let x = oX.value;
    let z = oZ.value;

    // Slot snap — detent at the last position before a slot/child disappears.
    // Works for both edge and corner affinity parents with slots.
    if (config.slots && config.slots.length > 0) {
      // Determine slide axis from slot positions: find axis with most spread
      const originItem = { ...item, x: 0, z: 0 };
      let spreadX = 0, spreadZ = 0;
      for (const slot of config.slots) {
        const sp = getSlotWorldPosition(originItem, slot, null, 0.8);
        spreadX = Math.max(spreadX, Math.abs(sp.x));
        spreadZ = Math.max(spreadZ, Math.abs(sp.z));
      }
      const isHorizontal = spreadX >= spreadZ;

      const rot = item.rotation || 0;
      const cosR = Math.abs(Math.cos(rot));
      const sinR = Math.abs(Math.sin(rot));

      // Compute per-side extent from parent center to outermost slot/child edge
      let lowExtent = 0, highExtent = 0;
      for (const slot of config.slots) {
        const child = this.sceneData.getChildInSlot(item.id, slot.id);
        const slotPos = getSlotWorldPosition(
          originItem, slot, child ? child.type : null, child ? undefined : 0.8
        );
        // Full extent = distance from parent center to outer edge of slot/child
        const slideOffset = isHorizontal ? slotPos.x : slotPos.z;
        let childHalf;
        if (child) {
          const childFp = FURNITURE[child.type].footprint;
          childHalf = isHorizontal
            ? (childFp.w * cosR + childFp.d * sinR) / 2
            : (childFp.w * sinR + childFp.d * cosR) / 2;
        } else {
          childHalf = 0.8 / 2;
        }
        const extent = Math.abs(slideOffset) + childHalf;

        if (slideOffset < 0) {
          lowExtent = Math.max(lowExtent, extent);
        } else {
          highExtent = Math.max(highExtent, extent);
        }
      }

      const roomMax = isHorizontal ? this.room.width : this.room.height;
      const pos = isHorizontal ? x : z;

      const slotBuffer = 0.15;
      const snapRange  = 0.25;

      const snapLow  = lowExtent + slotBuffer;
      const snapHigh = roomMax - highExtent - slotBuffer;

      // Center snap: use the relevant edge midpoint (edgeId or majorEdgeId)
      const midEdgeId = item.edgeId != null ? item.edgeId : item.majorEdgeId;
      const midEdge = midEdgeId != null ? this.edges.getEdge(midEdgeId) : null;
      const snapMid = midEdge
        ? (isHorizontal ? (midEdge.x1 + midEdge.x2) : (midEdge.z1 + midEdge.z2)) / 2
        : roomMax / 2;

      let snapped = pos;
      let centerSnapped = false;
      let slotSnapped = false;
      let slotSnapPos = 0;
      if (Math.abs(pos - snapMid) < snapRange) {
        snapped = snapMid;
        centerSnapped = true;
      } else if (pos < snapLow + snapRange && pos > snapLow - snapRange) {
        snapped = snapLow;
        slotSnapped = true;
        slotSnapPos = snapped;
      } else if (pos > snapHigh - snapRange && pos < snapHigh + snapRange) {
        snapped = snapHigh;
        slotSnapped = true;
        slotSnapPos = snapped;
      }

      if (isHorizontal) x = snapped;
      else z = snapped;

      // Resolve edge for snap lines: edgeId (edge affinity) or majorEdgeId (corner affinity)
      const snapEdgeId = item.edgeId != null ? item.edgeId : item.majorEdgeId;
      const snapEdge = snapEdgeId != null ? this.edges.getEdge(snapEdgeId) : null;

      const perpRange = this._getSnapLineRange(item, isHorizontal);

      if (centerSnapped) {
        this._showCenterLine(snapMid, isHorizontal, perpRange);
      } else {
        this._hideCenterLine();
      }

      if (slotSnapped) {
        const slotLinePos = slotSnapPos === snapLow
          ? slotSnapPos - lowExtent
          : slotSnapPos + highExtent;
        this._showSlotLine(slotLinePos, isHorizontal, perpRange);
      } else {
        this._hideSlotLine();
      }
    }

    // Check collision with other items
    const overlaps = Collision.findOverlaps(item.type, x, z, item, this.sceneData, item.id);

    let targetX, targetZ;
    if (overlaps.length === 0) {
      this._lastValidX = x;
      this._lastValidZ = z;
      targetX = x;
      targetZ = z;
    } else {
      const dx = x - this._lastValidX;
      const dz = z - this._lastValidZ;
      const collisionLimit = 0.3;
      const dampX = collisionLimit * (1 - 1 / (1 + Math.abs(dx) / collisionLimit));
      const dampZ = collisionLimit * (1 - 1 / (1 + Math.abs(dz) / collisionLimit));
      targetX = this._lastValidX + Math.sign(dx) * dampX;
      targetZ = this._lastValidZ + Math.sign(dz) * dampZ;
    }

    // Smooth lerp toward target
    const lerp = 0.35;
    const smoothX = item.x + (targetX - item.x) * lerp;
    const smoothZ = item.z + (targetZ - item.z) * lerp;
    this.sceneData.update(item.id, { x: smoothX, z: smoothZ });
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
    this._hideCenterLine();
    this._hideSlotLine();

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

    const draggedId = this.dragItemId;
    this.dragItemId = null;

    if (this.state.is(STATES.TRANSFORM)) {
      this.state.set(STATES.SELECTED, { itemId: draggedId });
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

  /**
   * Compute the perpendicular range for snap lines.
   * For edge affinity: edge position → edge + zone depth.
   * For corner affinity: full corner zone bounds on the perp axis.
   */
  _getSnapLineRange(item, isHorizontal) {
    const config = FURNITURE[item.type];
    if (config.affinity === 'corner' && item.cornerId != null && this.corners) {
      const zone = this.corners.getZone(item.cornerId, config.footprint);
      return isHorizontal
        ? { min: zone.minZ, max: zone.maxZ }
        : { min: zone.minX, max: zone.maxX };
    }
    // Edge affinity: use the edge's zone depth
    const edgeId = item.edgeId != null ? item.edgeId : item.majorEdgeId;
    const edge = edgeId != null ? this.edges.getEdge(edgeId) : null;
    if (!edge) return { min: 0, max: isHorizontal ? this.room.height : this.room.width };

    const edgePos = isHorizontal
      ? (edge.z1 + edge.z2) / 2
      : (edge.x1 + edge.x2) / 2;
    const zoneEnd = isHorizontal
      ? edgePos + edge.normal.z * edge.zoneDepth
      : edgePos + edge.normal.x * edge.zoneDepth;
    return { min: Math.min(edgePos, zoneEnd), max: Math.max(edgePos, zoneEnd) };
  }

  // ── Center snap line ──────────────────────────────────

  _showCenterLine(snapPos, isHorizontal, perpRange) {
    if (this._centerLine && this._centerLinePos === snapPos) return;
    this._hideCenterLine();
    this._centerLinePos = snapPos;

    const pts = isHorizontal
      ? [new THREE.Vector3(snapPos, 0.005, perpRange.min), new THREE.Vector3(snapPos, 0.005, perpRange.max)]
      : [new THREE.Vector3(perpRange.min, 0.005, snapPos), new THREE.Vector3(perpRange.max, 0.005, snapPos)];

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this._centerLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x378ADD }));
    this.sceneCtrl.scene.add(this._centerLine);
  }

  _hideCenterLine() {
    if (!this._centerLine) return;
    this.sceneCtrl.scene.remove(this._centerLine);
    this._centerLine = null;
    this._centerLinePos = null;
  }

  // ── Slot snap line (green) ────────────────────────────

  _showSlotLine(slotPos, isHorizontal, perpRange) {
    if (this._slotLine && this._slotLinePos === slotPos) return;
    this._hideSlotLine();
    this._slotLinePos = slotPos;

    const pts = isHorizontal
      ? [new THREE.Vector3(slotPos, 0.005, perpRange.min), new THREE.Vector3(slotPos, 0.005, perpRange.max)]
      : [new THREE.Vector3(perpRange.min, 0.005, slotPos), new THREE.Vector3(perpRange.max, 0.005, slotPos)];

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this._slotLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x88cc88 }));
    this.sceneCtrl.scene.add(this._slotLine);
  }

  _hideSlotLine() {
    if (!this._slotLine) return;
    this.sceneCtrl.scene.remove(this._slotLine);
    this._slotLine = null;
    this._slotLinePos = null;
    this._slotLineEdge = null;
  }
}
