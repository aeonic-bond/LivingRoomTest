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
   * @param {Object} opts
   * @param {boolean} [opts.showGrid=true]
   */
  constructor(scene, room, opts = {}) {
    this.scene = scene;
    this.room  = room;
    this.showGrid = opts.showGrid !== undefined ? opts.showGrid : true;

    this._buildLighting();
    this._buildFloor();
    this._buildGrid();
  }

  _buildLighting() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.35);
    dirLight.position.set(10, 20, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.left   = -20;
    dirLight.shadow.camera.right  =  20;
    dirLight.shadow.camera.top    =  20;
    dirLight.shadow.camera.bottom = -20;
    dirLight.shadow.radius = 12;
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

  showZone(minX, minZ, maxX, maxZ, color) {
    this.hideZone();
    const w = maxX - minX;
    const d = maxZ - minZ;
    const zoneColor = color || 0x378ADD;

    this._zoneFillTarget  = 0.06;
    this._zoneBorderTarget = 0.2;

    const zoneMat = new THREE.MeshBasicMaterial({
      color: zoneColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this._zoneFill = new THREE.Mesh(new THREE.PlaneGeometry(w, d), zoneMat);
    this._zoneFill.rotation.x = -Math.PI / 2;
    this._zoneFill.position.set(minX + w / 2, 0.002, minZ + d / 2);
    this.scene.add(this._zoneFill);

    const borderMat = new THREE.LineBasicMaterial({
      color: zoneColor,
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

  // ── Selection outline ──────────────────────────────────

  selectItem(itemId) {
    if (this._selectedId === itemId) return;
    this.deselectItem();
    this._selectedId = itemId;
    const group = this.meshes[itemId];
    if (!group) return;

    const item = this.sceneData.get(itemId);
    if (!item) return;
    const config = FURNITURE[item.type];
    if (!config) return;
    const fp = config.footprint;

    // Halo: padded outline matching footprint shape
    const pad = 0.3;
    const r = 0.25;
    let shape;

    if (fp.type === 'L') {
      shape = MeshFactory.lShapeHaloShape(fp, pad, r);
    } else {
      shape = MeshFactory.roundedRectHaloShape(fp.w + pad * 2, fp.d + pad * 2, r);
    }

    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);

    const halo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x378ADD,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
    }));
    halo.position.y = 0.002;
    halo.name = '_selectionHalo';
    group.add(halo);
  }

  deselectItem() {
    if (this._selectedId == null) return;
    const group = this.meshes[this._selectedId];
    if (group) {
      const halo = group.getObjectByName('_selectionHalo');
      if (halo) group.remove(halo);
    }
    this._selectedId = null;
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

    // Children derive position and rotation from parent
    if (item.parentId != null) {
      const parentItem = this.sceneData.get(item.parentId);
      if (parentItem) {
        const parentConfig = FURNITURE[parentItem.type];
        const slotConfig = parentConfig.slotGroups.find(s => s.id === item.slotGroupId);
        if (slotConfig) {
          const pos = getSlotWorldPosition(parentItem, slotConfig, item.type, null, item.subSlot);
          item.x = pos.x;
          item.z = pos.z;
        }
        item.rotation = parentItem.rotation || 0;
      }
    }

    const group = MeshFactory.build(config, item);
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

    // When a parent moves, update all children
    this._updateChildren(item);
  }

  /**
   * Recompute world positions for all children of a parent item.
   * Hides children that would be out of bounds or colliding.
   */
  _updateChildren(parentItem) {
    const children = this.sceneData.getChildren(parentItem.id);
    if (children.length === 0) return;

    const parentConfig = FURNITURE[parentItem.type];
    if (!parentConfig || !parentConfig.slotGroups) return;

    const rot = parentItem.rotation || 0;
    const cosR = Math.abs(Math.cos(rot));
    const sinR = Math.abs(Math.sin(rot));

    for (const child of children) {
      if (child._dragging) continue;
      const slotConfig = parentConfig.slotGroups.find(s => s.id === child.slotGroupId);
      if (!slotConfig) continue;

      const pos = getSlotWorldPosition(parentItem, slotConfig, child.type, null, child.subSlot);
      child.x = pos.x;
      child.z = pos.z;
      child.rotation = rot;

      // AABB of child in world space
      const childFp = FURNITURE[child.type].footprint;
      const halfW = (childFp.w * cosR + childFp.d * sinR) / 2;
      const halfD = (childFp.w * sinR + childFp.d * cosR) / 2;

      const blocked = isSlotBlocked(pos, halfW, halfD, parentItem.id, this.room, this.sceneData);
      child.ghosted = blocked;

      const childGroup = this.meshes[child.id];
      if (childGroup) {
        childGroup.position.set(pos.x, 0, pos.z);
        childGroup.rotation.y = rot;
        childGroup.visible = true;
        this._setGhosted(childGroup, blocked);
      }
    }
  }

  /**
   * Set ghosted visual state on a mesh group (reduced opacity).
   */
  _setGhosted(group, ghosted) {
    const opacity = ghosted ? 0.25 : 1.0;
    group.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.transparent = true;
        child.material.opacity = opacity;
      }
    });
  }

}
