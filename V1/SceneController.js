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
}
