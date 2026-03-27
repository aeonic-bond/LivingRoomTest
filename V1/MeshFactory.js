/**
 * MeshFactory
 *
 * Builds Three.js mesh groups for furniture types.
 * Each type gets a composed group of primitives with
 * stylized proportions and subtle material variation.
 *
 * Used by SceneController._addMesh — keeps geometry
 * concerns out of the scene lifecycle.
 */
const MeshFactory = {

  // ── Shared proportions ──────────────────────────────────
  _armW: 0.55,
  _backD: 0.8,
  _seatH: 0.35,
  _backH: 0.6,
  _armH: 0.5,
  _gap: 0.05,
  _r: 0.12,

  // ── Materials ───────────────────────────────────────────
  _seatMat: null,
  _backMat: null,
  _armMat:  null,
  _defaultMat: null,

  _ensureMaterials() {
    if (this._seatMat) return;
    this._seatMat    = new THREE.MeshStandardMaterial({ color: 0x909090, roughness: 0.55 });
    this._backMat    = new THREE.MeshStandardMaterial({ color: 0x6e6e6e, roughness: 0.5 });
    this._armMat     = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, roughness: 0.5 });
    this._defaultMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 });
  },

  // ── Public API ──────────────────────────────────────────

  /**
   * Build a mesh group for a furniture item.
   * @param {Object} config - FurnitureConfig entry
   * @param {Object} item   - SceneData item
   * @returns {THREE.Group}
   */
  build(config, item) {
    this._ensureMaterials();
    const group = new THREE.Group();

    if (config.mesh.type === 'sectional') {
      this._buildSectional(group, config);
      group.scale.set(item.sx, 1, item.sz);
    } else if (config.mesh.type === 'couch') {
      this._buildCouch(group, config);
      group.rotation.y = item.rotation || 0;
    } else {
      this._buildBox(group, config);
      group.rotation.y = item.rotation || 0;
    }

    group.position.set(item.x, 0, item.z);
    return group;
  },

  // ── Builders ────────────────────────────────────────────

  _buildBox(group, config) {
    const m = config.mesh;
    const geo = new THREE.BoxGeometry(m.w, m.h, m.d);
    const mesh = new THREE.Mesh(geo, this._defaultMat);
    mesh.position.y = m.h / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  },

  /**
   * Stylized couch: back cushion, seat cushions, armrests.
   * Local space: back = -Z (wall side), front = +Z (room side).
   */
  _buildCouch(group, config) {
    const fp = config.footprint;
    const W = fp.w;
    const D = fp.d;

    const { _armW: armW, _backD: backD, _seatH: seatH, _backH: backH,
            _armH: armH, _gap: gap, _r: r } = this;

    const innerW = W - 2 * armW;
    const seatD = D - backD;
    const numCushions = 3;
    const cushionW = (innerW - (numCushions - 1) * gap) / numCushions;

    const halfW = W / 2;
    const halfD = D / 2;

    const addPart = (geo, mat, x, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, 0, z);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    };

    // Back cushion — between arms, at -Z edge (wall side)
    addPart(
      this._roundedBoxGeo(innerW, backD, backH, r), this._backMat,
      0, -halfD + backD / 2
    );

    // Seat cushions — between arms, front portion (+Z = room side)
    const seatZ = halfD - seatD / 2;
    const startX = -innerW / 2;
    for (let i = 0; i < numCushions; i++) {
      const cx = startX + cushionW / 2 + i * (cushionW + gap);
      addPart(
        this._roundedBoxGeo(cushionW, seatD, seatH, r), this._seatMat,
        cx, seatZ
      );
    }

    // Armrests — full depth on left/right edges
    const armR = Math.min(r, armW / 3);
    addPart(this._roundedBoxGeo(armW, D, armH, armR), this._armMat, -halfW + armW / 2, 0);
    addPart(this._roundedBoxGeo(armW, D, armH, armR), this._armMat, halfW - armW / 2, 0);
  },

  /**
   * Stylized sectional (sofa + chaise).
   * Local space: hinge center at origin.
   * Major arm extends along +X, minor arm along +Z.
   */
  _buildSectional(group, config) {
    const fp = config.footprint;
    const h = fp.hinge;
    const majorW = h.w + fp.majorThrust;

    const { _armW: armW, _backD: backD, _seatH: seatH, _backH: backH,
            _armH: armH, _gap: gap, _r: r } = this;

    const offX = -h.w / 2;
    const offZ = -h.d / 2;

    const addPart = (geo, mat, x, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, 0, z);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    };

    const armR = Math.min(r, armW / 3);

    // ── Armrests ─────────────────────────────────────────────
    // Left armrest at hinge side (major arm depth only)
    addPart(
      this._roundedBoxGeo(armW, h.d, armH, armR), this._armMat,
      offX + armW / 2, offZ + h.d / 2
    );
    // Right armrest at far +X end of major arm
    addPart(
      this._roundedBoxGeo(armW, h.d, armH, armR), this._armMat,
      offX + majorW - armW / 2, offZ + h.d / 2
    );

    // ── Major arm (sofa section, extends along +X) ──────────
    // Back cushion between the two armrests
    const majorBackW = majorW - 2 * armW;
    addPart(
      this._roundedBoxGeo(majorBackW, backD, backH, r), this._backMat,
      offX + armW + majorBackW / 2,
      offZ + backD / 2
    );

    // Seat cushions (between back and front edge, between armrests)
    const majorSeatD = h.d - backD;
    const majorSeatW = majorW - h.w - armW;
    const numMajorCushions = 2;
    const majorCushionW = (majorSeatW - (numMajorCushions - 1) * gap) / numMajorCushions;
    const majorSeatZ = offZ + backD + majorSeatD / 2;
    for (let i = 0; i < numMajorCushions; i++) {
      const cx = offX + h.w + i * (majorCushionW + gap) + majorCushionW / 2;
      addPart(
        this._roundedBoxGeo(majorCushionW, majorSeatD, seatH, r), this._seatMat,
        cx, majorSeatZ
      );
    }

    // ── Hinge area (corner seat cushion, between left arm and chaise) ──
    const hingeSeatW = h.w - armW;
    const hingeSeatD = h.d - backD;
    addPart(
      this._roundedBoxGeo(hingeSeatW, hingeSeatD, seatH, r), this._seatMat,
      offX + armW + hingeSeatW / 2, offZ + backD + hingeSeatD / 2
    );

    // ── Minor arm (chaise section, extends along +Z) ────────
    // Single large open seat cushion
    const chaiseSeatW = h.w;
    const chaiseSeatD = fp.minorThrust;
    addPart(
      this._roundedBoxGeo(chaiseSeatW, chaiseSeatD, seatH, r), this._seatMat,
      offX + chaiseSeatW / 2,
      offZ + h.d + chaiseSeatD / 2
    );
  },

  // ── Geometry helpers ────────────────────────────────────

  /**
   * Rounded box geometry via ExtrudeGeometry.
   * Bottom at y=0, top at ~y=h.
   */
  _roundedBoxGeo(w, d, h, r) {
    const shape = this._roundedRectShape(w, d, r);
    const bevel = 0.03;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: h,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, bevel, 0);
    return geo;
  },

  /**
   * Rounded rectangle Shape (XY plane).
   */
  _roundedRectShape(w, d, r) {
    r = Math.min(r, w / 2, d / 2);
    const hw = w / 2, hd = d / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-hw + r, -hd);
    shape.lineTo( hw - r, -hd);
    shape.quadraticCurveTo( hw, -hd,  hw, -hd + r);
    shape.lineTo( hw,  hd - r);
    shape.quadraticCurveTo( hw,  hd,  hw - r,  hd);
    shape.lineTo(-hw + r,  hd);
    shape.quadraticCurveTo(-hw,  hd, -hw,  hd - r);
    shape.lineTo(-hw, -hd + r);
    shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
    return shape;
  },

  /**
   * L-shaped halo Shape (XY plane, for ShapeGeometry).
   * Hinge center at origin. Major along +X, minor along +Z.
   */
  lShapeHaloShape(fp, pad, r) {
    const h = fp.hinge;
    const hw = h.w / 2;
    const hd = h.d / 2;
    const majorW = h.w + fp.majorThrust;

    const x1 = -hw - pad,           y1 =  hd + pad;
    const x2 = -hw + majorW + pad,  y2 =  hd + pad;
    const x3 = -hw + majorW + pad,  y3 = -hd - pad;
    const x4 =  hw + pad,           y4 = -hd - pad;
    const x5 =  hw + pad,           y5 = -hd - fp.minorThrust - pad;
    const x6 = -hw - pad,           y6 = -hd - fp.minorThrust - pad;

    const shape = new THREE.Shape();

    shape.moveTo(x1 + r, y1);

    shape.lineTo(x2 - r, y2);
    shape.quadraticCurveTo(x2, y2, x2, y2 - r);

    shape.lineTo(x3, y3 + r);
    shape.quadraticCurveTo(x3, y3, x3 - r, y3);

    shape.lineTo(x4, y4);

    shape.lineTo(x5, y5 + r);
    shape.quadraticCurveTo(x5, y5, x5 - r, y5);

    shape.lineTo(x6 + r, y6);
    shape.quadraticCurveTo(x6, y6, x6, y6 + r);

    shape.lineTo(x1, y1 - r);
    shape.quadraticCurveTo(x1, y1, x1 + r, y1);

    return shape;
  },

  /**
   * Rounded rectangle halo Shape.
   */
  roundedRectHaloShape(w, d, r) {
    return this._roundedRectShape(w, d, r);
  },
};
