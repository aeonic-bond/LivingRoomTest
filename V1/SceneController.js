// ── Color tokens (read from globalTokens.css) ────────────────
function cssColor(varName) {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return new THREE.Color(hex);
}
const COLOR_DIVIDER_GRAY_BASE = cssColor('--color-divider-gray-base');
const COLOR_DIVIDER_GRAY_FADE = cssColor('--color-divider-gray-fade');
const COLOR_WHITE_BASE        = cssColor('--color-white-base');

/**
 * SceneController
 *
 * Owns the Three.js scene contents: floor, grid, lighting.
 * Furniture objects and raycasting will be added here.
 */
class SceneController {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} room - room config with width, height, panelCols, panelRows, unitsPerPanel
   * @param {THREE.OrthographicCamera} camera
   * @param {HTMLCanvasElement} canvas
   * @param {Object} opts
   * @param {boolean} [opts.showGrid=true]
   */
  constructor(scene, room, camera, canvas, opts = {}) {
    this.scene  = scene;
    this.room   = room;
    this.camera = camera;
    this.canvas = canvas;
    this.showGrid = opts.showGrid !== undefined ? opts.showGrid : true;

    this._buildLighting();
    this._buildFloor();
    this._buildGrid();
  }

  _buildLighting() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(10, 20, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.left   = -20;
    dirLight.shadow.camera.right  =  20;
    dirLight.shadow.camera.top    =  20;
    dirLight.shadow.camera.bottom = -20;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.25);
    fillLight.position.set(-8, 10, -6);
    this.scene.add(fillLight);
  }

  _buildFloor() {
    const mat = new THREE.MeshStandardMaterial({ color: COLOR_WHITE_BASE, roughness: 0.9 });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.room.width, this.room.height),
      mat
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(this.room.width / 2, -0.01, this.room.height / 2);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  _buildGrid() {
    this.gridGroup = new THREE.Group();
    this.gridGroup.visible = this.showGrid;

    const unitMat  = new THREE.LineBasicMaterial({ color: COLOR_DIVIDER_GRAY_FADE });
    const panelMat = new THREE.LineBasicMaterial({ color: COLOR_DIVIDER_GRAY_BASE });

    const W = this.room.width;
    const H = this.room.height;
    const P = this.room.unitsPerPanel;

    // Unit lines (1ft subdivisions)
    for (let i = 1; i < W; i++) {
      if (i % P === 0) continue; // skip panel lines
      const pts = [new THREE.Vector3(i, 0.001, 0), new THREE.Vector3(i, 0.001, H)];
      this.gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), unitMat));
    }
    for (let j = 1; j < H; j++) {
      if (j % P === 0) continue;
      const pts = [new THREE.Vector3(0, 0.001, j), new THREE.Vector3(W, 0.001, j)];
      this.gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), unitMat));
    }

    // Panel lines (4ft divisions)
    for (let i = 1; i < this.room.panelCols; i++) {
      const x = i * P;
      const pts = [new THREE.Vector3(x, 0.002, 0), new THREE.Vector3(x, 0.002, H)];
      this.gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), panelMat));
    }
    for (let j = 1; j < this.room.panelRows; j++) {
      const z = j * P;
      const pts = [new THREE.Vector3(0, 0.002, z), new THREE.Vector3(W, 0.002, z)];
      this.gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), panelMat));
    }

    this.scene.add(this.gridGroup);
  }

  /** Toggle grid visibility. */
  setGridVisible(visible) {
    this.gridGroup.visible = visible;
  }

  // ── Zone highlight ─────────────────────────────────────

  showZone(minX, minZ, maxX, maxZ) {
    this.hideZone();
    const w = maxX - minX;
    const d = maxZ - minZ;

    this._zoneFillTarget  = 0.06;
    this._zoneBorderTarget = 0.2;

    const zoneMat = new THREE.MeshBasicMaterial({
      color: 0x378ADD,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this._zoneFill = new THREE.Mesh(new THREE.PlaneGeometry(w, d), zoneMat);
    this._zoneFill.rotation.x = -Math.PI / 2;
    this._zoneFill.position.set(minX + w / 2, 0.002, minZ + d / 2);
    this.scene.add(this._zoneFill);

    const borderMat = new THREE.LineBasicMaterial({
      color: 0x378ADD,
      transparent: true,
      opacity: 0,
    });
    const pts = [
      new THREE.Vector3(minX, 0.004, minZ),
      new THREE.Vector3(maxX, 0.004, minZ),
      new THREE.Vector3(maxX, 0.004, maxZ),
      new THREE.Vector3(minX, 0.004, maxZ),
      new THREE.Vector3(minX, 0.004, minZ),
    ];
    this._zoneBorder = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      borderMat
    );
    this.scene.add(this._zoneBorder);
  }

  hideZone() {
    if (this._zoneFill) { this.scene.remove(this._zoneFill); this._zoneFill = null; }
    if (this._zoneBorder) { this.scene.remove(this._zoneBorder); this._zoneBorder = null; }
  }

  updateZone() {
    if (!this._zoneFill || !this._zoneBorder) return;
    const lerp = 0.12;
    const fillMat = this._zoneFill.material;
    const borderMat = this._zoneBorder.material;
    fillMat.opacity += (this._zoneFillTarget - fillMat.opacity) * lerp;
    borderMat.opacity += (this._zoneBorderTarget - borderMat.opacity) * lerp;
  }

  // ── Hover highlight (HTML overlay bbox) ────────────────

  _worldToScreen(wx, wz) {
    const v = new THREE.Vector3(wx, 0, wz);
    v.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width,
      y: (-v.y + 1) / 2 * rect.height,
    };
  }

  hoverItem(itemId) {
    if (this._hoveredId === itemId) return;
    this.unhoverItem();
    this._hoveredId = itemId;

    const item = this.sceneData.get(itemId);
    if (!item) return;
    const config = FURNITURE[item.type];
    if (!config) return;

    const fp = config.footprint;
    const pad = 0.15;
    let minX, minZ, maxX, maxZ;

    if (fp.type === 'L') {
      const rects = Collision.getWorldRects(item.type, item.x, item.z, item);
      minX = Infinity; minZ = Infinity; maxX = -Infinity; maxZ = -Infinity;
      for (const r of rects) {
        minX = Math.min(minX, r.minX);
        minZ = Math.min(minZ, r.minZ);
        maxX = Math.max(maxX, r.maxX);
        maxZ = Math.max(maxZ, r.maxZ);
      }
    } else {
      const cosR = Math.abs(Math.cos(item.rotation || 0));
      const sinR = Math.abs(Math.sin(item.rotation || 0));
      const halfX = (fp.w * cosR + fp.d * sinR) / 2;
      const halfZ = (fp.w * sinR + fp.d * cosR) / 2;
      minX = item.x - halfX;
      maxX = item.x + halfX;
      minZ = item.z - halfZ;
      maxZ = item.z + halfZ;
    }

    // Convert world bbox corners to screen
    const topLeft = this._worldToScreen(minX - pad, minZ - pad);
    const bottomRight = this._worldToScreen(maxX + pad, maxZ + pad);

    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.left = topLeft.x + 'px';
    el.style.top = topLeft.y + 'px';
    el.style.width = (bottomRight.x - topLeft.x) + 'px';
    el.style.height = (bottomRight.y - topLeft.y) + 'px';
    el.style.border = '4px solid #378ADD';
    el.style.borderRadius = '4px';
    el.style.pointerEvents = 'none';
    el.style.boxSizing = 'border-box';

    this.canvas.parentElement.appendChild(el);
    this._hoverEl = el;
  }

  unhoverItem() {
    if (this._hoverEl) {
      this._hoverEl.remove();
      this._hoverEl = null;
    }
    this._hoveredId = null;
  }

  // ── Selection outline ──────────────────────────────────

  selectItem(itemId) {
    this.deselectItem();
    this._selectedId = itemId;
    const group = this.meshes[itemId];
    if (!group) return;

    group.traverse((child) => {
      if (child.isMesh) {
        const edges = new THREE.EdgesGeometry(child.geometry);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
          color: 0x378ADD,
          linewidth: 1,
        }));
        line.name = '_selectionOutline';
        child.add(line);
      }
    });

    this._showSlots(itemId);
  }

  deselectItem() {
    if (this._selectedId == null) return;
    const group = this.meshes[this._selectedId];
    if (group) {
      group.traverse((child) => {
        if (child.isMesh) {
          const outline = child.getObjectByName('_selectionOutline');
          if (outline) child.remove(outline);
        }
      });
    }
    this._hideSlots();
    this._selectedId = null;
  }

  // ── Child slot indicators ────────────────────────────────

  _showSlots(parentId) {
    this._hideSlots();
    const item = this.sceneData.get(parentId);
    if (!item) return;
    const config = FURNITURE[item.type];
    if (!config || !config.slots) return;

    this._slotMeshes = [];
    const slotSize = 1.5; // visual size of slot indicator (ft)

    config.slots.forEach(slot => {
      // Skip slots that already have a child
      if (this.sceneData.getChildInSlot(parentId, slot.id)) return;

      const pos = getSlotWorldPosition(item, slot, null, slotSize);

      // Check if initially blocked
      const half = slotSize / 2;
      const initBlocked = this._isSlotBlocked(pos, half, parentId);

      const group = new THREE.Group();

      // Green fill (same as pulse: 0x88cc88)
      const fillGeo = new THREE.PlaneGeometry(slotSize, slotSize);
      const fillMat = new THREE.MeshBasicMaterial({
        color: 0x88cc88,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      });
      const fillMesh = new THREE.Mesh(fillGeo, fillMat);
      fillMesh.rotation.x = -Math.PI / 2;
      group.add(fillMesh);

      // Border square
      const borderPts = [
        new THREE.Vector3(-slotSize / 2, 0.001, -slotSize / 2),
        new THREE.Vector3( slotSize / 2, 0.001, -slotSize / 2),
        new THREE.Vector3( slotSize / 2, 0.001,  slotSize / 2),
        new THREE.Vector3(-slotSize / 2, 0.001,  slotSize / 2),
        new THREE.Vector3(-slotSize / 2, 0.001, -slotSize / 2),
      ];
      const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
      const borderMat = new THREE.LineBasicMaterial({ color: 0x88cc88 });
      group.add(new THREE.Line(borderGeo, borderMat));

      // Plus cross
      const plusSize = 0.4;
      const plusMat = new THREE.LineBasicMaterial({ color: 0xd9d9d9 });
      // Horizontal bar
      const hPts = [new THREE.Vector3(-plusSize / 2, 0, 0), new THREE.Vector3(plusSize / 2, 0, 0)];
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts), plusMat));
      // Vertical bar
      const vPts = [new THREE.Vector3(0, 0, -plusSize / 2), new THREE.Vector3(0, 0, plusSize / 2)];
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vPts), plusMat));

      // Start at parent center, animate to target
      group.position.set(item.x, 0.003, item.z);
      group.userData.slotId = slot.id;
      group.userData.parentId = parentId;
      group.userData.targetX = pos.x;
      group.userData.targetZ = pos.z;
      group.userData.slideT = 0;
      group.visible = !initBlocked;
      this.scene.add(group);
      this._slotMeshes.push(group);
    });
  }

  /**
   * Call from render loop to animate slot slide-out.
   */
  updateSlots() {
    if (!this._slotMeshes) return;
    for (const g of this._slotMeshes) {
      if (g.userData.slideT >= 1) continue;
      g.userData.slideT = Math.min(1, g.userData.slideT + 0.06);
      // Ease-out cubic
      const t = 1 - Math.pow(1 - g.userData.slideT, 3);
      const parentItem = this.sceneData.get(g.userData.parentId);
      if (!parentItem) continue;
      g.position.x = parentItem.x + (g.userData.targetX - parentItem.x) * t;
      g.position.z = parentItem.z + (g.userData.targetZ - parentItem.z) * t;
    }
  }

  /**
   * Move existing slot indicators to follow parent during drag.
   * Checks bounds + collision per slot to show/hide dynamically.
   */
  _updateSlotPositions(item) {
    const config = FURNITURE[item.type];
    if (!config || !config.slots) return;
    const slotSize = 1.5;
    const half = slotSize / 2;

    for (const g of this._slotMeshes) {
      const slotConfig = config.slots.find(s => s.id === g.userData.slotId);
      if (!slotConfig) continue;
      const pos = getSlotWorldPosition(item, slotConfig, null, slotSize);
      g.userData.targetX = pos.x;
      g.userData.targetZ = pos.z;

      const wasVisible = g.visible;
      const nowVisible = !this._isSlotBlocked(pos, half, item.id);
      g.visible = nowVisible;

      // Reset slide animation when becoming visible
      if (nowVisible && !wasVisible) {
        g.userData.slideT = 0;
        g.position.x = item.x;
        g.position.z = item.z;
      }

      // If animation is done, snap directly
      if (g.userData.slideT >= 1) {
        g.position.x = pos.x;
        g.position.z = pos.z;
      }
    }
  }

  _hideSlots() {
    if (!this._slotMeshes) return;
    this._slotMeshes.forEach(g => this.scene.remove(g));
    this._slotMeshes = null;
  }

  /**
   * Check if a slot position is out of bounds or colliding with other items.
   */
  _isSlotBlocked(pos, half, parentId) {
    // Room bounds
    if (pos.x - half < 0 || pos.x + half > this.room.width ||
        pos.z - half < 0 || pos.z + half > this.room.height) return true;

    // Collision with placed items
    const slotRect = {
      minX: pos.x - half, minZ: pos.z - half,
      maxX: pos.x + half, maxZ: pos.z + half,
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

  // ── Furniture rendering ─────────────────────────────────

  /**
   * Bind to a SceneData instance to render furniture.
   * Call after construction.
   */
  bindData(sceneData) {
    this.sceneData = sceneData;
    this.meshes = {};
    sceneData.on('add', (item) => this._addMesh(item));
    sceneData.on('remove', (item) => this._removeMesh(item));
    sceneData.on('update', (item) => this._updateMesh(item));
  }

  _addMesh(item) {
    const config = FURNITURE[item.type];
    if (!config) return;

    const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 });
    const group = new THREE.Group();
    const fp = config.footprint;

    if (fp.type === 'L') {
      // L-shape: build two arm boxes in canonical orientation, centered on hinge
      const h = fp.hinge;
      const mh = config.mesh.h;
      // Offset so hinge center is at group origin
      const offX = -h.w / 2;
      const offZ = -h.d / 2;

      // Major arm: hinge + thrust along +x
      const majorW = h.w + fp.majorThrust;
      const majorGeo = new THREE.BoxGeometry(majorW, mh, h.d);
      const majorMesh = new THREE.Mesh(majorGeo, mat);
      majorMesh.position.set(offX + majorW / 2, mh / 2, offZ + h.d / 2);
      majorMesh.castShadow = true;
      majorMesh.receiveShadow = true;
      group.add(majorMesh);

      // Minor arm: thrust along +z (no hinge overlap)
      const minorD = fp.minorThrust;
      const minorGeo = new THREE.BoxGeometry(h.w, mh, minorD);
      const minorMesh = new THREE.Mesh(minorGeo, mat);
      minorMesh.position.set(offX + h.w / 2, mh / 2, offZ + h.d + minorD / 2);
      minorMesh.castShadow = true;
      minorMesh.receiveShadow = true;
      group.add(minorMesh);

      // Mirror to match corner orientation
      group.scale.set(item.sx, 1, item.sz);
    } else {
      // Rect: single box centered at origin
      const m = config.mesh;
      const geo = new THREE.BoxGeometry(m.w, m.h, m.d);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = m.h / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      group.rotation.y = item.rotation || 0;
    }

    group.position.set(item.x, 0, item.z);
    this.scene.add(group);
    this.meshes[item.id] = group;
  }

  _removeMesh(item) {
    const group = this.meshes[item.id];
    if (!group) return;
    this.scene.remove(group);
    delete this.meshes[item.id];
  }

  _updateMesh(item) {
    const group = this.meshes[item.id];
    if (!group) return;
    group.position.set(item.x, 0, item.z);
    group.rotation.y = item.rotation || 0;

    // Move slot indicators with parent during drag
    if (item.id === this._selectedId && this._slotMeshes) {
      this._updateSlotPositions(item);
    }
  }
}
