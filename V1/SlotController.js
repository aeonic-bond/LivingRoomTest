/**
 * SlotController
 *
 * Manages child slot indicators for selected furniture.
 * Event-driven: reacts to SceneData add/remove to toggle
 * individual slot visibility. All show/hide transitions
 * use the same slide animation.
 */
class SlotController {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} room
   * @param {SceneData} sceneData
   */
  constructor(scene, room, sceneData) {
    this.scene     = scene;
    this.room      = room;
    this.sceneData = sceneData;

    this._slots    = null;  // Map: slotGroupId → mesh
    this._parentId = null;
    this._animSpeed = 0.03;
    this._hoveredSlotId = null;
    this._activeSubSlot = null;  // 'front' or 'back'
    this._lockedHover = false;

    // React to child add/remove
    this.sceneData.on('add', (item) => this._onChildAdd(item));
    this.sceneData.on('remove', (item) => this._onChildRemove(item));
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Show slot indicators for a parent item.
   * Creates meshes for ALL slots — filled ones start hidden.
   */
  show(parentId, force) {
    if (this._parentId === parentId && !force) return;
    this._destroy();
    this._parentId = parentId;

    const item = this.sceneData.get(parentId);
    if (!item) return;
    const config = FURNITURE[item.type];
    if (!config || !config.slotGroups) return;

    this._slots = {};
    this._parentRotation = item.rotation || 0;
    const fp = config.footprint;

    // Derive indicator width from largest allowed child
    const childW = this._getMaxChildWidth(config);

    config.slotGroups.forEach(slotGroup => {
      const depth = this._getSideDepth(fp, slotGroup.side);
      const children = this.sceneData.getChildrenInSlotGroup(parentId, slotGroup.id);
      const childCount = children.length;

      // Determine indicator size and position based on child count
      let indicatorW, indicatorD, subSlotTarget, pos;
      if (childCount === 0) {
        // Empty: full-size indicator centered on side
        indicatorW = childW;
        indicatorD = depth;
        subSlotTarget = null;
        pos = getSlotWorldPosition(item, slotGroup, null, childW);
      } else if (childCount === 1) {
        // Partial: half-size indicator at the empty sub-slot
        const occupiedSubSlot = children[0].subSlot || 'back';
        subSlotTarget = (occupiedSubSlot === 'back') ? 'front' : 'back';
        indicatorW = childW;
        indicatorD = depth / 2;
        pos = getSlotWorldPosition(item, slotGroup, null, childW, subSlotTarget);
      } else {
        // Full: hidden
        indicatorW = childW;
        indicatorD = depth;
        pos = getSlotWorldPosition(item, slotGroup, null, childW);
      }

      const halfW = indicatorW / 2;
      const halfD = indicatorD / 2;
      const isFull = childCount >= 2;
      const blocked = isFull || this._isBlocked(pos, halfW, halfD, parentId);

      const mesh = this._buildSlotGroupMesh(indicatorW, indicatorD, item.rotation, slotGroup.side);
      mesh.position.set(item.x, 0.003, item.z);
      mesh.userData.slotGroupId = slotGroup.id;
      mesh.userData.side       = slotGroup.side;
      mesh.userData.parentId   = parentId;
      mesh.userData.targetX    = pos.x;
      mesh.userData.targetZ    = pos.z;
      mesh.userData.halfW      = halfW;
      mesh.userData.halfD      = halfD;
      mesh.userData.subSlotTarget = subSlotTarget; // which sub-slot this indicator represents

      // Animation state
      mesh.userData.slideT   = 0;
      mesh.userData.hiding   = false;
      mesh.userData.filled   = isFull;
      mesh.visible = !blocked;

      this.scene.add(mesh);
      this._slots[slotGroup.id] = mesh;
    });
  }

  /**
   * Animate all visible slots back into parent, then clean up.
   */
  hide() {
    if (!this._slots) return;
    for (const slotId in this._slots) {
      const g = this._slots[slotId];
      this._setVisible(g, false);
    }
    this._parentId = null;
  }

  /**
   * Call from render loop. Drives all slide animations.
   */
  update() {
    if (!this._slots) return;
    let anyActive = false;

    for (const slotId in this._slots) {
      const g = this._slots[slotId];
      const parentItem = this.sceneData.get(g.userData.parentId);
      if (!parentItem) continue;

      if (g.userData.hiding) {
        anyActive = true;
        g.userData.slideT = Math.min(1, g.userData.slideT + this._animSpeed);
        const t = 1 - Math.pow(1 - g.userData.slideT, 3);
        g.position.x = g.userData.hideFromX + (parentItem.x - g.userData.hideFromX) * t;
        g.position.z = g.userData.hideFromZ + (parentItem.z - g.userData.hideFromZ) * t;
        if (g.userData.slideT >= 1) {
          g.visible = false;
          g.userData.hiding = false;
        }
      } else if (g.visible && g.userData.slideT < 1) {
        anyActive = true;
        g.userData.slideT = Math.min(1, g.userData.slideT + this._animSpeed);
        const t = 1 - Math.pow(1 - g.userData.slideT, 3);
        g.position.x = parentItem.x + (g.userData.targetX - parentItem.x) * t;
        g.position.z = parentItem.z + (g.userData.targetZ - parentItem.z) * t;
      }
    }

    // All animations done and no active parent — destroy meshes
    if (!anyActive && this._parentId === null) {
      this._destroy();
    }
  }

  /**
   * Update slot positions and visibility during parent drag.
   */
  updatePositions(item) {
    if (!this._slots) return;

    // Rotation changed (reorientation) — rebuild slots
    const currentRotation = item.rotation || 0;
    if (currentRotation !== this._parentRotation) {
      this.show(item.id, true);
      return;
    }

    const config = FURNITURE[item.type];
    if (!config || !config.slotGroups) return;
    const childW = this._getMaxChildWidth(config);

    for (const slotId in this._slots) {
      const g = this._slots[slotId];
      if (g.userData.filled) continue;

      const slotConfig = config.slotGroups.find(s => s.id === slotId);
      if (!slotConfig) continue;
      const pos = getSlotWorldPosition(item, slotConfig, null, childW, g.userData.subSlotTarget);
      g.userData.targetX = pos.x;
      g.userData.targetZ = pos.z;

      const shouldShow = !this._isBlocked(pos, g.userData.halfW, g.userData.halfD, item.id);
      this._setVisible(g, shouldShow);

      // If visible and animation done, snap to follow parent
      if (g.visible && !g.userData.hiding && g.userData.slideT >= 1) {
        g.position.x = pos.x;
        g.position.z = pos.z;
      }
    }
  }

  /**
   * Get the parent id currently showing slots.
   */
  get parentId() {
    return this._parentId;
  }

  /**
   * Lock a slot in hover state (e.g. during PLACING_CHILD).
   */
  lockHover(slotId) {
    this._lockedHover = true;
    this._setHoveredSlot(slotId);
  }

  /**
   * Release hover lock.
   */
  unlockHover() {
    this._lockedHover = false;
    this._setHoveredSlot(null);
  }

  /**
   * Update hover state from a world position. Call from mouse move.
   */
  updateHover(x, z) {
    if (this._lockedHover) return;
    if (!this._slots) { this._setHoveredSlot(null); return; }
    for (const slotId in this._slots) {
      const g = this._slots[slotId];
      if (!g.visible || g.userData.hiding || g.userData.filled) continue;
      if (this._hitTestRect(g, x, z)) {
        this._setHoveredSlot(slotId);
        // Partial state: no split needed, sub-slot is predetermined
        if (!g.userData.subSlotTarget) {
          // Empty state: determine front/back from cursor's local Z
          const localZ = this._getLocalZ(g, x, z);
          // -Z local = toward edge/wall = back, +Z local = into room = front
          const subSlot = localZ < 0 ? 'back' : 'front';
          if (subSlot !== this._activeSubSlot) {
            this._activeSubSlot = subSlot;
            this._showSplit(g, subSlot);
          }
        }
        return;
      }
    }
    this._setHoveredSlot(null);
  }

  _setHoveredSlot(slotId) {
    if (this._hoveredSlotId === slotId) return;

    // Un-hover previous — revert to merged view
    if (this._hoveredSlotId && this._slots && this._slots[this._hoveredSlotId]) {
      const g = this._slots[this._hoveredSlotId];
      this._showMerged(g);
    }

    this._hoveredSlotId = slotId;
    this._activeSubSlot = null;
  }

  /**
   * Hit test: check if a world point falls within a visible, unfilled slot.
   * @returns {{ parentId, slotId } | null}
   */
  hitTest(x, z) {
    if (!this._slots) return null;
    for (const slotId in this._slots) {
      const g = this._slots[slotId];
      if (!g.visible || g.userData.hiding || g.userData.filled) continue;
      if (this._hitTestRect(g, x, z)) {
        // Partial state: subSlot is predetermined (the empty one)
        // Empty state: subSlot from hover detection
        const subSlot = g.userData.subSlotTarget || this._activeSubSlot || 'back';
        return {
          parentId: g.userData.parentId,
          slotGroupId: g.userData.slotGroupId,
          subSlot,
        };
      }
    }
    return null;
  }

  // ── Single visibility control ───────────────────────────

  /**
   * Unified show/hide for a single slot mesh.
   * Triggers slide-out or slide-back animation.
   */
  _setVisible(g, visible) {
    const isVisible = g.visible && !g.userData.hiding;

    if (visible && !isVisible) {
      // Show — slide out from parent
      if (g.userData.hiding) {
        // Was mid-hide, reverse
        g.userData.hiding = false;
        g.userData.slideT = 0;
      } else {
        // Fresh show
        const parentItem = this.sceneData.get(g.userData.parentId);
        if (parentItem) {
          g.position.x = parentItem.x;
          g.position.z = parentItem.z;
        }
        g.userData.slideT = 0;
      }
      g.visible = true;
    } else if (!visible && isVisible) {
      // Hide — slide back to parent
      g.userData.hiding = true;
      g.userData.slideT = 0;
      g.userData.hideFromX = g.position.x;
      g.userData.hideFromZ = g.position.z;
    }
  }

  // ── Event handlers ──────────────────────────────────────

  _onChildAdd(item) {
    if (!this._slots || item.parentId !== this._parentId) return;
    // Rebuild to reflect new child count (empty → partial, or partial → full)
    this.show(this._parentId, true);
  }

  _onChildRemove(item) {
    if (!this._slots || item.parentId !== this._parentId) return;
    // Rebuild to reflect new child count (full → partial, or partial → empty)
    this.show(this._parentId, true);
  }

  // ── Internal ────────────────────────────────────────────

  _destroy() {
    if (!this._slots) return;
    for (const slotId in this._slots) {
      this.scene.remove(this._slots[slotId]);
    }
    this._slots = null;
  }

  /**
   * Build a rounded-rect slot group mesh.
   * Width = max child width, depth = parent side depth.
   * Rotated to align with the parent's side.
   */
  _buildSlotGroupMesh(w, d, parentRotation, side) {
    const wrapper = new THREE.Group();

    // Merged view (default) — single rounded rect
    const merged = new THREE.Group();
    merged.name = 'merged';
    this._addSubSlotRect(merged, w, d, Math.min(w, d, 0.5) * 0.4, 0, true);
    wrapper.add(merged);

    // Split placeholder (built on hover by _showSplit)
    const split = new THREE.Group();
    split.name = 'split';
    split.visible = false;
    wrapper.add(split);

    // Rotate to align with parent side + parent rotation
    const sideAngle = (side === 'front' || side === 'back') ? Math.PI / 2 : 0;
    wrapper.rotation.y = parentRotation + sideAngle;

    return wrapper;
  }

  /**
   * Rotation-aware hit test for a slot group rect.
   */
  _hitTestRect(g, worldX, worldZ) {
    const dx = worldX - g.position.x;
    const dz = worldZ - g.position.z;
    const rot = g.rotation.y || 0;
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    return Math.abs(localX) <= g.userData.halfW && Math.abs(localZ) <= g.userData.halfD;
  }

  /**
   * Get max child footprint width from allowedChildren.
   */
  _getMaxChildWidth(config) {
    if (!config.allowedChildren) return 1;
    let maxW = 0;
    for (const childId of config.allowedChildren) {
      const c = FURNITURE[childId];
      if (c && c.footprint) maxW = Math.max(maxW, c.footprint.w, c.footprint.d);
    }
    return maxW || 1;
  }

  /**
   * Get parent's depth along a given side.
   */
  _getSideDepth(fp, side) {
    if (fp.type === 'L') {
      return (side === 'left' || side === 'right') ? fp.hinge.d : fp.hinge.w;
    }
    return (side === 'left' || side === 'right') ? fp.d : fp.w;
  }

  /**
   * Project a world point into a slot group's local Z (depth axis).
   */
  _getLocalZ(g, worldX, worldZ) {
    const dx = worldX - g.position.x;
    const dz = worldZ - g.position.z;
    const rot = g.rotation.y || 0;
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    return dx * sin + dz * cos;
  }

  /**
   * Show merged (default) view — single rect, hide split children.
   */
  _showMerged(g) {
    const merged = g.getObjectByName('merged');
    const split  = g.getObjectByName('split');
    if (merged) merged.visible = true;
    if (split)  split.visible = false;
  }

  /**
   * Show split view — two sub-rects, active one green, inactive gray.
   * Rebuilds split children each time to swap sizes correctly.
   */
  _showSplit(g, activeSubSlot) {
    const merged = g.getObjectByName('merged');
    if (merged) merged.visible = false;

    let split = g.getObjectByName('split');
    if (split) g.remove(split);

    split = new THREE.Group();
    split.name = 'split';

    const w = g.userData.halfW * 2;
    const d = g.userData.halfD * 2;
    const gap = 0.15;
    const halfD = d / 2;

    // Active sub-slot = half the depth, inactive = other half
    const subD = (d - gap) / 2;
    const rSub = Math.min(w, subD, 0.5) * 0.4;

    // Back = -Z (toward edge/wall), front = +Z (into room)
    const backZ  = -(halfD - subD / 2);
    const frontZ =  (halfD - subD / 2);

    const backActive  = (activeSubSlot === 'back');
    const frontActive = (activeSubSlot === 'front');

    this._addSubSlotRect(split, w, subD, rSub, backZ, backActive);
    this._addSubSlotRect(split, w, subD, rSub, frontZ, frontActive);

    g.add(split);
  }

  /**
   * Add a single sub-slot rounded rect to a parent group.
   */
  _addSubSlotRect(parent, w, h, r, offsetZ, active) {
    const color = active ? 0x38725C : 0xD0CECE;
    const fillOpacity = active ? 0.1 : 0.03;
    const borderOpacity = active ? 0.8 : 0.4;
    const plusOpacity = active ? 0.8 : 0.3;

    const shape = this._roundedRectShape(w, h, r);

    // Fill
    const fillGeo = new THREE.ShapeGeometry(shape);
    const fillMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: fillOpacity, depthWrite: false,
    });
    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    fillMesh.rotation.x = -Math.PI / 2;
    fillMesh.position.z = offsetZ;
    parent.add(fillMesh);

    // Dashed border
    const pts = shape.getPoints(32);
    const pts3D = pts.map(p => new THREE.Vector3(p.x, 0.001, -p.y + offsetZ));
    pts3D.push(pts3D[0].clone());
    const borderGeo = new THREE.BufferGeometry().setFromPoints(pts3D);
    const dashedMat = new THREE.LineDashedMaterial({
      color, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: borderOpacity,
    });
    const borderLine = new THREE.Line(borderGeo, dashedMat);
    borderLine.computeLineDistances();
    parent.add(borderLine);

    // Plus
    const plusSize = 0.22;
    const plusMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: plusOpacity });
    const hPts = [
      new THREE.Vector3(-plusSize / 2, 0.002, offsetZ),
      new THREE.Vector3(plusSize / 2, 0.002, offsetZ),
    ];
    parent.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts), plusMat));
    const vPts = [
      new THREE.Vector3(0, 0.002, offsetZ - plusSize / 2),
      new THREE.Vector3(0, 0.002, offsetZ + plusSize / 2),
    ];
    parent.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vPts), plusMat));
  }

  /**
   * Create a rounded rect THREE.Shape centered at origin.
   */
  _roundedRectShape(w, h, r) {
    const shape = new THREE.Shape();
    const hw = w / 2, hh = h / 2;
    shape.moveTo(-hw + r, -hh);
    shape.lineTo(hw - r, -hh);
    shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
    shape.lineTo(hw, hh - r);
    shape.quadraticCurveTo(hw, hh, hw - r, hh);
    shape.lineTo(-hw + r, hh);
    shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
    shape.lineTo(-hw, -hh + r);
    shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    return shape;
  }

  _isBlocked(pos, halfW, halfD, parentId) {
    return isSlotBlocked(pos, halfW, halfD, parentId, this.room, this.sceneData);
  }
}
