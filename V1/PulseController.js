// ── Color tokens (read from globalTokens.css) ────────────────
function pulseCssColor(varName) {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return new THREE.Color(hex);
}
const PULSE_COLOR_DIVIDER = pulseCssColor('--color-divider-gray-base');

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
    this.ringOpacity = 0.8;
    this.fillOpacity = 0.1;

    // Pulse config
    this.pulseSize   = 3;       // default 3x3 units
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

  _updateRingShape(radius, time) {
    const ringPos = this.ringGeo.attributes.position.array;
    const fillPos = this.fillGeo.attributes.position.array;
    const n = this.ringResolution;
    const half = this.pulseSize / 2;

    // Clamp bounds: pulse box AND room edges (relative to pulse center)
    const minX = Math.max(-half, -this.centerX);
    const maxX = Math.min( half,  this.room.width - this.centerX);
    const minZ = Math.max(-half, -this.centerZ);
    const maxZ = Math.min( half,  this.room.height - this.centerZ);

    const maxNoise = this.pulseNoise;
    const noiseStrength = maxNoise * Math.min(1, radius / (half * 0.7));

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

      let x = Math.max(minX, Math.min(maxX, Math.cos(angle) * r));
      let z = Math.max(minZ, Math.min(maxZ, Math.sin(angle) * r));

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
   * Start pulsing at a position. Follows future setPosition calls.
   */
  start(x, z) {
    this.centerX = x;
    this.centerZ = z;
    this.group.position.x = x;
    this.group.position.z = z;
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
    this.centerX = x;
    this.centerZ = z;
    this.group.position.x = x;
    this.group.position.z = z;
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
  }

  /**
   * Update pulse config on the fly (e.g. when hovering a menu item).
   */
  setConfig(config) {
    if (config.pulseSize !== undefined)   this.pulseSize   = config.pulseSize;
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

      const half = this.pulseSize / 2;
      const maxRadius = half * Math.SQRT2;
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
        this.group.visible = false;
        this.intervalTimer = 0;
      }
    } else {
      this.intervalTimer += dt;
      if (this.intervalTimer >= this.interval) {
        this.pulsing = true;
        this.elapsed = 0;
        this.group.visible = true;
      }
    }
  }
}
