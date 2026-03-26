// ── Color tokens (read from globalTokens.css) ────────────────
function pulseCssColor(varName) {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return new THREE.Color(hex);
}
const PULSE_COLOR_DIVIDER = pulseCssColor('--color-divider-gray-base');
const PULSE_COLOR_BLACK   = pulseCssColor('--color-black-base');

/**
 * PulseController
 *
 * Renders the expanding pulse effect on the grid.
 * Can be triggered by any controller (CursorController, PlacingMenu, etc.).
 * Behavior changes based on state — follows cursor in DEFAULT, anchors in PLACING.
 */
class PulseController {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} room
   */
  constructor(scene, room) {
    this.scene = scene;
    this.room  = room;

    // Color / opacity config
    this.strokeColor = PULSE_COLOR_DIVIDER;
    this.fillColor   = new THREE.Color(0xffaacc);
    this.plusColor    = PULSE_COLOR_BLACK;
    this.ringOpacity = 0.8;
    this.fillOpacity = 0.1;
    this.plusOpacity  = 0.8;

    // Pulse config
    this.pulseSize   = 3;       // default square size (used when pulseW/pulseD are null)
    this.pulseW      = null;    // override width (set by furniture footprint)
    this.pulseD      = null;    // override depth (set by furniture footprint)
    this.rotation    = 0;       // radians (from EdgeAffinity, determines axis mapping)
    this.pulsePeriod = 1;       // seconds per cycle
    this.interval    = 0.4;     // seconds between pulse starts
    this.pulseNoise  = 0;       // wobble intensity (0 = perfect circle)
    this.pulseStart  = 0.3;     // starting radius fraction

    // State
    this.active        = false;
    this.anchored      = false;
    this.centerX       = 0;
    this.centerZ       = 0;
    this.elapsed       = 0;
    this.intervalTimer = 0;
    this.pulsing       = false;
    this.lastTime      = 0;

    // Build visuals
    this.group = new THREE.Group();
    this.group.visible = false;
    this._buildGeometry();
    this.scene.add(this.group);
  }

  _buildGeometry() {
    // Ring (stroke)
    this.ringResolution = 64;
    const positions = new Float32Array(this.ringResolution * 3);
    this.ringGeo = new THREE.BufferGeometry();
    this.ringGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.ringMat = new THREE.LineBasicMaterial({
      color: this.strokeColor,
      transparent: true,
      opacity: 0,
    });
    this.ring = new THREE.LineLoop(this.ringGeo, this.ringMat);
    this.ring.position.y = 0.005;
    this.group.add(this.ring);

    // Fill (triangle fan matching ring shape)
    const fillVerts = new Float32Array((this.ringResolution + 1) * 3);
    const fillIndices = [];
    for (let i = 0; i < this.ringResolution; i++) {
      fillIndices.push(0, i + 1, ((i + 1) % this.ringResolution) + 1);
    }
    this.fillGeo = new THREE.BufferGeometry();
    this.fillGeo.setAttribute('position', new THREE.BufferAttribute(fillVerts, 3));
    this.fillGeo.setIndex(fillIndices);
    this.fillMat = new THREE.MeshBasicMaterial({
      color: this.fillColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fill = new THREE.Mesh(this.fillGeo, this.fillMat);
    this.fill.position.y = 0.003;
    this.group.add(this.fill);

    // Plus symbol
    const plusSize = 0.25;
    this.plusMat = new THREE.LineBasicMaterial({
      color: this.plusColor,
      transparent: true,
      opacity: this.plusOpacity,
    });
    const hPts = [new THREE.Vector3(-plusSize, 0, 0), new THREE.Vector3(plusSize, 0, 0)];
    const vPts = [new THREE.Vector3(0, 0, -plusSize), new THREE.Vector3(0, 0, plusSize)];
    this.plusGroup = new THREE.Group();
    this.plusGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts), this.plusMat));
    this.plusGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vPts), this.plusMat));
    this.plusGroup.position.y = 0.006;
    this.group.add(this.plusGroup);
  }

  // ── Noise ────────────────────────────────────────────────

  _noise(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  }

  _smoothNoise(t, seed) {
    const i = Math.floor(t);
    const f = t - i;
    const smooth = f * f * (3 - 2 * f);
    const a = this._noise(i + seed);
    const b = this._noise(i + 1 + seed);
    return a + (b - a) * smooth;
  }

  // ── Shape ────────────────────────────────────────────────

  /**
   * Get the axis-aligned half-extents of the pulse.
   * Uses pulseW/pulseD if set, otherwise falls back to pulseSize.
   * Rotation swaps which dimension maps to which world axis.
   */
  _getHalfExtents() {
    const w = this.pulseW !== null ? this.pulseW : this.pulseSize;
    const d = this.pulseD !== null ? this.pulseD : this.pulseSize;
    const cosR = Math.abs(Math.cos(this.rotation));
    const sinR = Math.abs(Math.sin(this.rotation));
    return {
      halfX: (w * cosR + d * sinR) / 2,
      halfZ: (w * sinR + d * cosR) / 2,
    };
  }

  _updateRingShape(radius, time) {
    const ringPos = this.ringGeo.attributes.position.array;
    const fillPos = this.fillGeo.attributes.position.array;
    const n = this.ringResolution;
    const { halfX, halfZ } = this._getHalfExtents();

    // Clamp bounds: pulse box AND room edges (relative to pulse center)
    const minX = Math.max(-halfX, -this.centerX);
    const maxX = Math.min( halfX,  this.room.width - this.centerX);
    const minZ = Math.max(-halfZ, -this.centerZ);
    const maxZ = Math.min( halfZ,  this.room.height - this.centerZ);

    const maxNoise = this.pulseNoise;
    const avgHalf = (halfX + halfZ) / 2;
    const noiseStrength = maxNoise * Math.min(1, radius / (avgHalf * 0.7));

    fillPos[0] = 0;
    fillPos[1] = 0;
    fillPos[2] = 0;

    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;

      const nSample = (i / n) * 6;
      const n1 = this._smoothNoise(nSample + time * 1.2, 0) * 1.0;
      const n2 = this._smoothNoise(nSample * 2.3 + time * 0.8, 50) * 0.5;
      const wobble = 1 + (n1 + n2) * noiseStrength;

      const r = radius * wobble;

      // Expand as circle, clamp to rectangular bounds
      const rawX = Math.cos(angle) * r;
      const rawZ = Math.sin(angle) * r;
      let x = Math.max(minX, Math.min(maxX, rawX));
      let z = Math.max(minZ, Math.min(maxZ, rawZ));

      ringPos[i * 3]     = x;
      ringPos[i * 3 + 1] = 0;
      ringPos[i * 3 + 2] = z;

      const fi = (i + 1) * 3;
      fillPos[fi]     = x;
      fillPos[fi + 1] = 0;
      fillPos[fi + 2] = z;
    }

    this.ringGeo.attributes.position.needsUpdate = true;
    this.fillGeo.attributes.position.needsUpdate = true;
  }

  // ── Public API ───────────────────────────────────────────

  /**
   * Nudge an origin unit by the minimum amount so a full pulse fits in the room.
   */
  _adjustOrigin(x, z) {
    const { halfX, halfZ } = this._getHalfExtents();
    return {
      x: Math.max(halfX, Math.min(this.room.width - halfX, x)),
      z: Math.max(halfZ, Math.min(this.room.height - halfZ, z)),
    };
  }

  /**
   * Start pulsing at a position. Follows future setPosition calls.
   */
  start(x, z) {
    this.rawX = x;
    this.rawZ = z;
    const o = this._adjustOrigin(x, z);
    this.centerX = o.x;
    this.centerZ = o.z;
    this.group.position.x = o.x;
    this.group.position.z = o.z;
    this.plusGroup.position.x = x - o.x;
    this.plusGroup.position.z = z - o.z;
    this.group.visible = true;
    this.active = true;
    this.anchored = false;
    this.lastTime = performance.now();
    this.intervalTimer = this.interval;
  }

  /**
   * Start pulsing anchored at a fixed position. Ignores setPosition.
   */
  startAnchored(x, z) {
    this.start(x, z);
    this.anchored = true;
  }

  /**
   * Update the pulse position (ignored if anchored).
   */
  setPosition(x, z) {
    if (this.anchored) return;
    this.rawX = x;
    this.rawZ = z;
    const o = this._adjustOrigin(x, z);
    this.centerX = o.x;
    this.centerZ = o.z;
    this.group.position.x = o.x;
    this.group.position.z = o.z;
    this.plusGroup.position.x = x - o.x;
    this.plusGroup.position.z = z - o.z;
  }

  /**
   * Force-trigger a pulse immediately, interrupting any current cycle.
   */
  trigger() {
    if (!this.active) return;
    this.pulsing = true;
    this.elapsed = 0;
    this.group.visible = true;
    this.lastTime = performance.now();
  }

  /**
   * Stop pulsing and hide.
   */
  stop() {
    this.active = false;
    this.pulsing = false;
    this.anchored = false;
    this.intervalTimer = 0;
    this.group.visible = false;
    this.group.visible = false;
  }

  /**
   * Update pulse config on the fly (e.g. when hovering a menu item).
   */
  setConfig(config) {
    if (config.pulseSize !== undefined)   this.pulseSize   = config.pulseSize;
    if (config.pulseW !== undefined)      this.pulseW      = config.pulseW;
    if (config.pulseD !== undefined)      this.pulseD      = config.pulseD;
    if (config.rotation !== undefined)    this.rotation    = config.rotation;
    if (config.pulsePeriod !== undefined) this.pulsePeriod = config.pulsePeriod;
    if (config.interval !== undefined)    this.interval    = config.interval;
    if (config.pulseNoise !== undefined)  this.pulseNoise  = config.pulseNoise;
    if (config.pulseStart !== undefined)  this.pulseStart  = config.pulseStart;
    if (config.fillColor !== undefined)   { this.fillColor = config.fillColor; this.fillMat.color = config.fillColor; }
    if (config.strokeColor !== undefined) { this.strokeColor = config.strokeColor; this.ringMat.color = config.strokeColor; }
  }

  /**
   * Reset config to defaults.
   */
  resetConfig() {
    this.pulseSize   = 3;
    this.pulseW      = null;
    this.pulseD      = null;
    this.rotation    = 0;
    this.pulsePeriod = 1;
    this.interval    = 0.4;
    this.pulseNoise  = 0;
    this.pulseStart  = 0.3;
    this.fillColor   = new THREE.Color(0xffaacc);
    this.strokeColor = PULSE_COLOR_DIVIDER;
    this.fillMat.color = this.fillColor;
    this.ringMat.color = this.strokeColor;
  }

  /**
   * Call every frame from the render loop.
   */
  update() {
    if (!this.active) return;

    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (this.pulsing) {
      this.elapsed += dt;
      const progress = Math.min(1, this.elapsed / this.pulsePeriod);

      const eased = 1 - Math.pow(1 - progress, 2);

      const { halfX, halfZ } = this._getHalfExtents();
      const avgHalf = (halfX + halfZ) / 2;
      const maxRadius = avgHalf * Math.SQRT2;
      const minRadius = maxRadius * this.pulseStart;
      const radius = minRadius + eased * (maxRadius - minRadius);

      this._updateRingShape(radius, this.elapsed);

      const fadeIn  = Math.min(1, progress * 5);
      const fadeOut = Math.max(0, 1 - Math.pow(progress, 3));
      const opacity = fadeIn * fadeOut;

      this.ringMat.opacity = opacity * this.ringOpacity;
      this.fillMat.opacity = opacity * this.fillOpacity;

      if (progress >= 1) {
        this.pulsing = false;
        this.ringMat.opacity = 0;
        this.fillMat.opacity = 0;
        this.intervalTimer = 0;
      }
    } else {
      this.intervalTimer += dt;
      if (this.intervalTimer >= this.interval) {
        this.pulsing = true;
        this.elapsed = 0;
      }
    }
  }
}
