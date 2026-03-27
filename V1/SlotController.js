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

    this._slots    = null;  // Map: slotId → { mesh, state }
    this._parentId = null;
    this._slotSize = 0.8;
    this._animSpeed = 0.03;

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
    if (!config || !config.slots) return;

    this._slots = {};
    this._parentRotation = item.rotation || 0;
    const size = this._slotSize;
    const fp = config.footprint;

    config.slots.forEach(slot => {
      // Circle indicator: rotation-invariant, same size in all directions
      const half = size / 2;
      const pos = getSlotWorldPosition(item, slot, null, size);
      const filled = !!this.sceneData.getChildInSlot(parentId, slot.id);
      const blocked = filled || this._isBlocked(pos, half, half, parentId);

      const mesh = this._buildSlotMesh(size);
      mesh.position.set(item.x, 0.003, item.z);
      mesh.userData.slotId   = slot.id;
      mesh.userData.parentId = parentId;
      mesh.userData.targetX  = pos.x;
      mesh.userData.targetZ  = pos.z;
      mesh.userData.halfW    = half;
      mesh.userData.halfD    = half;

      // Animation state
      mesh.userData.slideT   = 0;
      mesh.userData.hiding   = false;
      mesh.userData.filled   = filled;
      mesh.visible = !blocked;

      this.scene.add(mesh);
      this._slots[slot.id] = mesh;
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
    if (!config || !config.slots) return;
    const size = this._slotSize;

    for (const slotId in this._slots) {
      const g = this._slots[slotId];
      if (g.userData.filled) continue;

      const slotConfig = config.slots.find(s => s.id === slotId);
      if (!slotConfig) continue;
      const pos = getSlotWorldPosition(item, slotConfig, null, size);
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
    const g = this._slots[item.slotId];
    if (!g) return;
    g.userData.filled = true;
    this._setVisible(g, false);
  }

  _onChildRemove(item) {
    if (!this._slots || item.parentId !== this._parentId) return;
    const g = this._slots[item.slotId];
    if (!g) return;
    g.userData.filled = false;

    // Check if slot position is valid before showing
    const parentItem = this.sceneData.get(this._parentId);
    if (!parentItem) return;
    const config = FURNITURE[parentItem.type];
    const slotConfig = config.slots.find(s => s.id === item.slotId);
    if (!slotConfig) return;
    const size = this._slotSize;
    const pos = getSlotWorldPosition(parentItem, slotConfig, null, size);
    if (!this._isBlocked(pos, g.userData.halfW, g.userData.halfD, this._parentId)) {
      g.userData.targetX = pos.x;
      g.userData.targetZ = pos.z;
      this._setVisible(g, true);
    }
  }

  // ── Internal ────────────────────────────────────────────

  _destroy() {
    if (!this._slots) return;
    for (const slotId in this._slots) {
      this.scene.remove(this._slots[slotId]);
    }
    this._slots = null;
  }

  _buildSlotMesh(diameter) {
    const group = new THREE.Group();
    const radius = diameter / 2;

    // Green fill circle
    const fillGeo = new THREE.CircleGeometry(radius, 32);
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x88cc88,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
    });
    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    fillMesh.rotation.x = -Math.PI / 2;
    group.add(fillMesh);

    // Dashed circle border
    const segments = 64;
    const circlePts = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      circlePts.push(new THREE.Vector3(
        Math.cos(theta) * radius,
        0.001,
        Math.sin(theta) * radius
      ));
    }
    const circleGeo = new THREE.BufferGeometry().setFromPoints(circlePts);
    const dashedMat = new THREE.LineDashedMaterial({
      color: 0x88cc88,
      dashSize: 0.08,
      gapSize: 0.06,
    });
    const circleLine = new THREE.Line(circleGeo, dashedMat);
    circleLine.computeLineDistances();
    group.add(circleLine);

    // Plus cross
    const plusSize = 0.22;
    const plusMat = new THREE.LineBasicMaterial({ color: 0xd9d9d9 });
    const hPts = [new THREE.Vector3(-plusSize / 2, 0, 0), new THREE.Vector3(plusSize / 2, 0, 0)];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts), plusMat));
    const vPts = [new THREE.Vector3(0, 0, -plusSize / 2), new THREE.Vector3(0, 0, plusSize / 2)];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vPts), plusMat));

    return group;
  }

  _isBlocked(pos, halfW, halfD, parentId) {
    // Room bounds
    if (pos.x - halfW < 0 || pos.x + halfW > this.room.width ||
        pos.z - halfD < 0 || pos.z + halfD > this.room.height) return true;

    // Collision with placed items (skip children, skip parent)
    const slotRect = {
      minX: pos.x - halfW, minZ: pos.z - halfD,
      maxX: pos.x + halfW, maxZ: pos.z + halfD,
    };
    for (const other of this.sceneData.items) {
      if (other.id === parentId) continue;
      if (other.parentId != null) continue;
      const otherRects = Collision.getWorldRects(other.type, other.x, other.z, other);
      for (const r of otherRects) {
        if (Collision.rectsOverlap(slotRect, r)) return true;
      }
    }
    return false;
  }
}
