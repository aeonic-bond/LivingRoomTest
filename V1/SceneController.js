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

  // ── Selection outline ──────────────────────────────────

  selectItem(itemId) {
    if (this._selectedId === itemId) return;
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
  }
}
