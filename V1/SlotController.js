/**
 * SlotController
 *
 * Manages slot group indicators for selected furniture.
 * Each slot group is a rounded rectangle matching the parent's
 * depth on that side × the largest allowed child width.
 *
 * Hover behavior (empty state):
 *   - Default: single merged indicator covering the full side depth
 *   - Hovered: splits into two sub-slots (front/back) based on cursor position.
 *     Active sub-slot = max child depth, inactive = remaining space.
 *
 * Event-driven: reacts to SceneData add/remove to update
 * slot group visibility. All show/hide transitions use slide animation.
 */

const SUB_SLOT_GAP = 0.15; // ft gap between front/back sub-slots on hover

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

    this._groups   = null;  // Map: groupId → mesh
    this._parentId = null;
    this._animSpeed = 0.03;
    this._hoveredGroupId = null;
    this._activeSubSlot  = null; // 'front' or 'back'
    this._lockedHover = false;

    // React to child add/remove
    this.sceneData.on('add', (item) => this._onChildAdd(item));
    this.sceneData.on('remove', (item) => this._onChildRemove(item));
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Show slot group indicators for a parent item.
   * Creates meshes for ALL groups — full ones start hidden.
   */
  show(parentId, force) {
    if (this._parentId === parentId && !force) return;
    this._destroy();
    this._parentId = parentId;

    const item = this.sceneData.get(parentId);
    if (!item) return;
    const config = FURNITURE[item.type];
    if (!config || !config.slotGroups) return;

    this._groups = {};
    this._parentRotation = item.rotation || 0;

    const childW = getMaxChildWidth(config);
    const childD = getMaxChildDepth(config);
    const halfChildW = childW / 2;

    config.slotGroups.forEach(group => {
      const depth = getSlotGroupDepth(config, group.side);
      const pos = getSlotGroupWorldPosition(item, group, null, childW);

      const children = this.sceneData.getChildrenInSlotGroup(parentId, group.id);
      const isFull = children.length >= 2;
      const blocked = isFull || this._isBlocked(pos, halfChildW, depth / 2, parentId);

      // Build group with merged + split sub-groups
      const mesh = this._buildSlotGroupMesh(childW, depth, childD, item.rotation, group.side);
      mesh.position.set(item.x, 0.003, item.z);
      mesh.userData.groupId    = group.id;
      mesh.userData.side       = group.side;
      mesh.userData.parentId   = parentId;
      mesh.userData.targetX    = pos.x;
      mesh.userData.targetZ    = pos.z;
      mesh.userData.halfW      = halfChildW;
      mesh.userData.halfD      = depth / 2;
      mesh.userData.totalDepth = depth;
      mesh.userData.childD     = childD;

      // Animation state
      mesh.userData.slideT   = 0;
      mesh.userData.hiding   = false;
      mesh.userData.full     = isFull;
      mesh.visible = !blocked;

      this.scene.add(mesh);
      this._groups[group.id] = mesh;
    });
  }

  /**
   * Animate all visible groups back into parent, then clean up.
   */
  hide() {
    if (!this._groups) return;
    for (const groupId in this._groups) {
      const g = this._groups[groupId];
      this._setVisible(g, false);
    }
    this._parentId = null;
  }

  /**
   * Call from render loop. Drives all slide animations.
   */
  update() {
    if (!this._groups) return;
    let anyActive = false;

    for (const groupId in this._groups) {
      const g = this._groups[groupId];
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
   * Update slot group positions and visibility during parent drag.
   */
  updatePositions(item) {
    if (!this._groups) return;

    // Rotation changed (reorientation) — rebuild
    const currentRotation = item.rotation || 0;
    if (currentRotation !== this._parentRotation) {
      this.show(item.id, true);
      return;
    }

    const config = FURNITURE[item.type];
    if (!config || !config.slotGroups) return;

    const childW = getMaxChildWidth(config);

    for (const groupId in this._groups) {
      const g = this._groups[groupId];
      if (g.userData.full) continue;

      const groupConfig = config.slotGroups.find(s => s.id === groupId);
      if (!groupConfig) continue;
      const pos = getSlotGroupWorldPosition(item, groupConfig, null, childW);
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
   * Get the parent id currently showing slot groups.
   */
  get parentId() {
    return this._parentId;
  }

  /**
   * Lock a group in hover state (e.g. during PLACING_CHILD).
   */
  lockHover(groupId) {
    this._lockedHover = true;
    this._setHoveredGroup(groupId);
  }

  /**
   * Release hover lock.
   */
  unlockHover() {
    this._lockedHover = false;
    this._setHoveredGroup(null);
  }

  /**
   * Update hover state from a world position. Call from mouse move.
   * When hovering an empty group, determines front/back sub-slot.
   */
  updateHover(x, z) {
    if (this._lockedHover) return;
    if (!this._groups) { this._setHoveredGroup(null); return; }

    for (const groupId in this._groups) {
      const g = this._groups[groupId];
      if (!g.visible || g.userData.hiding || g.userData.full) continue;

      const dx = x - g.position.x;
      const dz = z - g.position.z;
      if (Math.abs(dx) <= g.userData.halfW && Math.abs(dz) <= g.userData.halfD) {
        this._setHoveredGroup(groupId);

        // Determine front vs back from cursor position along the depth axis
        // Depth axis depends on side orientation:
        //   left/right: depth runs along world Z (adjusted for parent rotation)
        //   front/back: depth runs along world X
        const parentItem = this.sceneData.get(g.userData.parentId);
        if (parentItem) {
          const rot = parentItem.rotation || 0;
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);
          const side = g.userData.side;

          // Project cursor offset into parent-local space
          const localX = dx * cos + dz * sin;
          const localZ = -dx * sin + dz * cos;

          // Depth axis in local space: left/right = Z, front/back = X
          let depthOffset;
          if (side === 'left' || side === 'right') {
            depthOffset = localZ;
          } else {
            depthOffset = localX;
          }

          // Negative depth offset = front (toward lower Z/X), positive = back
          const subSlot = depthOffset < 0 ? 'front' : 'back';
          if (subSlot !== this._activeSubSlot) {
            this._activeSubSlot = subSlot;
            this._updateSplitView(g, subSlot);
          }
        }
        return;
      }
    }
    this._setHoveredGroup(null);
  }

  _setHoveredGroup(groupId) {
    if (this._hoveredGroupId === groupId) return;

    // Un-hover previous — revert to merged view
    if (this._hoveredGroupId && this._groups && this._groups[this._hoveredGroupId]) {
      const g = this._groups[this._hoveredGroupId];
      this._showMerged(g);
    }

    this._hoveredGroupId = groupId;
    this._activeSubSlot = null;

    // Hover new — split view will be set by updateHover's sub-slot detection
    if (groupId && this._groups && this._groups[groupId]) {
      // Split view activates when updateHover determines front/back
    }
  }

  /**
   * Show merged view, hide split view.
   */
  _showMerged(g) {
    const merged = g.getObjectByName('merged');
    const split  = g.getObjectByName('split');
    if (merged) merged.visible = true;
    if (split)  split.visible = false;
  }

  /**
   * Show split view, hide merged view. Style active/inactive sub-slots.
   */
  _showSplit(g) {
    const merged = g.getObjectByName('merged');
    const split  = g.getObjectByName('split');
    if (merged) merged.visible = false;
    if (split)  split.visible = true;
  }

  /**
   * Update which sub-slot is active (green) vs inactive (gray).
   */
  _updateSplitView(g, activeSubSlot) {
    this._showSplit(g);
    const split = g.getObjectByName('split');
    if (!split) return;

    const frontGroup = split.getObjectByName('subslot-front');
    const backGroup  = split.getObjectByName('subslot-back');

    if (frontGroup) this._styleSubSlot(frontGroup, activeSubSlot === 'front');
    if (backGroup)  this._styleSubSlot(backGroup, activeSubSlot === 'back');
  }

  /**
   * Style a sub-slot as active (green) or inactive (gray).
   */
  _styleSubSlot(subGroup, active) {
    subGroup.traverse((child) => {
      if (child.isMesh && child.material && child.material.transparent) {
        child.material.color.set(active ? 0x38725C : 0xD0CECE);
        child.material.opacity = active ? 0.15 : 0.05;
      }
      if (child.isLine) {
        if (child.material.isDashedLineMaterial) {
          child.material.color.set(active ? 0x38725C : 0xD0CECE);
          child.material.opacity = active ? 1.0 : 0.6;
          child.material.transparent = true;
        } else {
          // Plus cross
          child.material.color.set(active ? 0x38725C : 0xD0CECE);
        }
      }
    });
  }

  /**
   * Hit test: check if a world point falls within a visible, unfilled group.
   * Returns groupId and which sub-slot (front/back) was hit.
   * @returns {{ parentId, groupId, subSlot } | null}
   */
  hitTest(x, z) {
    if (!this._groups) return null;
    for (const groupId in this._groups) {
      const g = this._groups[groupId];
      if (!g.visible || g.userData.hiding || g.userData.full) continue;
      const dx = x - g.position.x;
      const dz = z - g.position.z;
      if (Math.abs(dx) <= g.userData.halfW && Math.abs(dz) <= g.userData.halfD) {
        return {
          parentId: g.userData.parentId,
          groupId:  g.userData.groupId,
          subSlot:  this._activeSubSlot || 'back',
        };
      }
    }
    return null;
  }

  // ── Single visibility control ───────────────────────────

  _setVisible(g, visible) {
    const isVisible = g.visible && !g.userData.hiding;

    if (visible && !isVisible) {
      if (g.userData.hiding) {
        g.userData.hiding = false;
        g.userData.slideT = 0;
      } else {
        const parentItem = this.sceneData.get(g.userData.parentId);
        if (parentItem) {
          g.position.x = parentItem.x;
          g.position.z = parentItem.z;
        }
        g.userData.slideT = 0;
      }
      g.visible = true;
    } else if (!visible && isVisible) {
      g.userData.hiding = true;
      g.userData.slideT = 0;
      g.userData.hideFromX = g.position.x;
      g.userData.hideFromZ = g.position.z;
    }
  }

  // ── Event handlers ──────────────────────────────────────

  _onChildAdd(item) {
    if (!this._groups || item.parentId !== this._parentId) return;
    const g = this._groups[item.slotGroupId];
    if (!g) return;

    const children = this.sceneData.getChildrenInSlotGroup(this._parentId, item.slotGroupId);
    if (children.length >= 2) {
      g.userData.full = true;
      this._setVisible(g, false);
    }
  }

  _onChildRemove(item) {
    if (!this._groups || item.parentId !== this._parentId) return;
    const g = this._groups[item.slotGroupId];
    if (!g) return;

    const children = this.sceneData.getChildrenInSlotGroup(this._parentId, item.slotGroupId);
    if (children.length < 2) {
      g.userData.full = false;

      const parentItem = this.sceneData.get(this._parentId);
      if (!parentItem) return;
      const config = FURNITURE[parentItem.type];
      const groupConfig = config.slotGroups.find(s => s.id === item.slotGroupId);
      if (!groupConfig) return;
      const childW = getMaxChildWidth(config);
      const pos = getSlotGroupWorldPosition(parentItem, groupConfig, null, childW);
      if (!this._isBlocked(pos, g.userData.halfW, g.userData.halfD, this._parentId)) {
        g.userData.targetX = pos.x;
        g.userData.targetZ = pos.z;
        this._setVisible(g, true);
      }
    }
  }

  // ── Internal ────────────────────────────────────────────

  _destroy() {
    if (!this._groups) return;
    for (const groupId in this._groups) {
      this.scene.remove(this._groups[groupId]);
    }
    this._groups = null;
    this._hoveredGroupId = null;
    this._activeSubSlot = null;
  }

  /**
   * Build a slot group mesh containing:
   *   - "merged" sub-group: single rounded rect (default view)
   *   - "split" sub-group: two sub-slot rounded rects (hover view)
   *
   * @param {number} w - width (max child width)
   * @param {number} d - depth (parent side depth)
   * @param {number} childD - max child depth (active sub-slot size)
   * @param {number} rotation - parent rotation
   * @param {string} side - 'left', 'right', 'front', 'back'
   */
  _buildSlotGroupMesh(w, d, childD, rotation, side) {
    const wrapper = new THREE.Group();
    const r = Math.min(w, d) * 0.2;

    // ── Merged view (default) ──────────────────────────
    const merged = new THREE.Group();
    merged.name = 'merged';
    this._addRoundedRect(merged, w, d, r, 0x38725C, 0.1);
    this._addPlus(merged, 0, 0);
    wrapper.add(merged);

    // ── Split view (on hover) ──────────────────────────
    const split = new THREE.Group();
    split.name = 'split';
    split.visible = false;

    const activeD   = childD;
    const inactiveD = d - childD - SUB_SLOT_GAP;
    const rActive   = Math.min(w, activeD) * 0.2;
    const rInactive = Math.min(w, Math.max(inactiveD, 0.1)) * 0.2;

    // "back" sub-slot: positive Z half (offset from center)
    const backOffZ = (d / 2) - (activeD / 2);
    const backGroup = new THREE.Group();
    backGroup.name = 'subslot-back';
    backGroup.position.z = backOffZ;
    this._addRoundedRect(backGroup, w, activeD, rActive, 0x38725C, 0.15);
    this._addPlus(backGroup, 0, 0);
    split.add(backGroup);

    // "front" sub-slot: negative Z half
    if (inactiveD > 0.1) {
      const frontOffZ = -(d / 2) + (inactiveD / 2);
      const frontGroup = new THREE.Group();
      frontGroup.name = 'subslot-front';
      frontGroup.position.z = frontOffZ;
      this._addRoundedRect(frontGroup, w, inactiveD, rInactive, 0xD0CECE, 0.05);
      this._addPlus(frontGroup, 0, 0);
      split.add(frontGroup);
    }

    wrapper.add(split);

    // Rotate for front/back sides
    if (side === 'front' || side === 'back') {
      wrapper.rotation.y = Math.PI / 2;
    }

    return wrapper;
  }

  /**
   * Add a rounded-rect fill + dashed border to a group.
   */
  _addRoundedRect(group, w, h, r, color, opacity) {
    const shape = this._roundedRectShape(w, h, r);

    // Fill
    const fillGeo = new THREE.ShapeGeometry(shape);
    const fillMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: opacity,
      depthWrite: false,
    });
    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    fillMesh.rotation.x = -Math.PI / 2;
    group.add(fillMesh);

    // Dashed border
    const borderPts = shape.getPoints(32);
    const border3D = borderPts.map(p => new THREE.Vector3(p.x, 0.001, -p.y));
    border3D.push(border3D[0].clone());
    const borderGeo = new THREE.BufferGeometry().setFromPoints(border3D);
    const dashedMat = new THREE.LineDashedMaterial({
      color: color,
      dashSize: 0.08,
      gapSize: 0.06,
      transparent: true,
      opacity: 1.0,
    });
    const borderLine = new THREE.Line(borderGeo, dashedMat);
    borderLine.computeLineDistances();
    group.add(borderLine);
  }

  /**
   * Add a plus cross to a group at the given local offset.
   */
  _addPlus(group, offX, offZ) {
    const plusSize = 0.22;
    const plusMat = new THREE.LineBasicMaterial({ color: 0x38725C });
    const hPts = [
      new THREE.Vector3(offX - plusSize / 2, 0.002, offZ),
      new THREE.Vector3(offX + plusSize / 2, 0.002, offZ),
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts), plusMat));
    const vPts = [
      new THREE.Vector3(offX, 0.002, offZ - plusSize / 2),
      new THREE.Vector3(offX, 0.002, offZ + plusSize / 2),
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vPts), plusMat));
  }

  /**
   * Create a THREE.Shape for a rounded rectangle centered at origin.
   */
  _roundedRectShape(w, h, r) {
    const shape = new THREE.Shape();
    const hw = w / 2;
    const hh = h / 2;

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
