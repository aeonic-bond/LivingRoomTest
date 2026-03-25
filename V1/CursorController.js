// ── Color tokens (read from globalTokens.css) ────────────────
function cursorCssColor(varName) {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return new THREE.Color(hex);
}
const CURSOR_COLOR_DIVIDER_FADE = cursorCssColor('--color-divider-gray-base');
const CURSOR_COLOR_BLACK_BASE   = cursorCssColor('--color-black-base');

/**
 * CursorController
 *
 * Manages cursor hover effects on the grid.
 * Shows a pulsing ripple that expands from circle to square,
 * indicating where objects can be placed.
 */
class CursorController {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} room - room config with width, height
   * @param {HTMLElement} canvas
   * @param {THREE.OrthographicCamera} camera
   */
  constructor(scene, room, canvas, camera) {
    this.scene  = scene;
    this.room   = room;
    this.canvas = canvas;
    this.camera = camera;

    // Color / opacity config
    this.strokeColor    = CURSOR_COLOR_DIVIDER_FADE;
    this.fillColor      = new THREE.Color(0xffaacc);
    this.plusColor       = CURSOR_COLOR_BLACK_BASE;
    this.ringOpacity    = 0.8;
    this.fillOpacity    = 0.1;

    // Pulse config
    this.pulseSize   = 3;           // 3x3 units (1 center + 1 on each side)
    this.pulsePeriod = 1;         // seconds per cycle
    this.interval    = 0.4;         // seconds between pulse starts
    this.pulseNoise  = 0.05;        // wobble intensity (0 = perfect circle)
    this.pulseStart  = 0.3;         // starting radius as fraction of max (0-1)

    // State
    this.enabled    = true;
    this.hovering   = false;       // cursor is over empty grid
    this.centerX    = 0;
    this.centerZ    = 0;
    this.elapsed    = 0;           // time within current pulse
    this.intervalTimer = 0;        // accumulates time to trigger next pulse
    this.pulsing    = false;       // a pulse is currently animating
    this.lastTime   = 0;

    // Raycasting
    this.raycaster = new THREE.Raycaster();
    this.mouse     = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Build visual layers
    this.root = new THREE.Group();   // always visible while hovering
    this.root.visible = false;
    this.group = new THREE.Group();  // pulse visuals (fades in/out)
    this.group.visible = false;
    this.root.add(this.group);
    this._buildRipple();
    this.scene.add(this.root);

    // Events
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseLeave = this._onMouseLeave.bind(this);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mouseleave', this._onMouseLeave);
  }

  _buildRipple() {
    // Ring (stroke) — built from a line loop, updated each frame
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

    // Fill — a fan geometry that matches the ring shape exactly
    // n triangles: center vertex + ring vertices
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

    // Center plus symbol
    const plusSize = 0.25;
    this.plusMat = new THREE.LineBasicMaterial({
      color: this.plusColor,
      transparent: true,
      opacity: 0,
    });
    const hPts = [new THREE.Vector3(-plusSize, 0, 0), new THREE.Vector3(plusSize, 0, 0)];
    const vPts = [new THREE.Vector3(0, 0, -plusSize), new THREE.Vector3(0, 0, plusSize)];
    this.plusH = new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts), this.plusMat);
    this.plusV = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vPts), this.plusMat);
    this.plusH.position.y = 0.006;
    this.plusV.position.y = 0.006;
    this.root.add(this.plusH);
    this.root.add(this.plusV);
  }

  /**
   * Simple seeded noise for organic wobble.
   * Returns a value roughly in [-1, 1].
   */
  _noise(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  }

  /**
   * Smooth noise by interpolating between integer sample points.
   */
  _smoothNoise(t, seed) {
    const i = Math.floor(t);
    const f = t - i;
    const smooth = f * f * (3 - 2 * f); // smoothstep
    const a = this._noise(i + seed);
    const b = this._noise(i + 1 + seed);
    return a + (b - a) * smooth;
  }

  /**
   * Generate ring points: a noisy blob clamped to the bounding box.
   * @param {number} radius - base ripple radius
   * @param {number} time - elapsed time for animating the noise
   */
  _updateRingShape(radius, time) {
    const ringPos = this.ringGeo.attributes.position.array;
    const fillPos = this.fillGeo.attributes.position.array;
    const n = this.ringResolution;
    const half = this.pulseSize / 2;

    // Noise intensity scales with radius — small = round, slightly wobbly when larger
    const maxNoise = this.pulseNoise;
    const noiseStrength = maxNoise * Math.min(1, radius / (half * 0.7));

    // Fill center vertex (index 0)
    fillPos[0] = 0;
    fillPos[1] = 0;
    fillPos[2] = 0;

    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;

      // Multi-octave noise for organic feel
      const nSample = (i / n) * 6;
      const n1 = this._smoothNoise(nSample + time * 1.2, 0) * 1.0;
      const n2 = this._smoothNoise(nSample * 2.3 + time * 0.8, 50) * 0.5;
      const wobble = 1 + (n1 + n2) * noiseStrength;

      const r = radius * wobble;

      // Clamp to bounding box
      let x = Math.max(-half, Math.min(half, Math.cos(angle) * r));
      let z = Math.max(-half, Math.min(half, Math.sin(angle) * r));

      // Ring
      ringPos[i * 3]     = x;
      ringPos[i * 3 + 1] = 0;
      ringPos[i * 3 + 2] = z;

      // Fill (offset by 1 because index 0 is center)
      const fi = (i + 1) * 3;
      fillPos[fi]     = x;
      fillPos[fi + 1] = 0;
      fillPos[fi + 2] = z;
    }

    this.ringGeo.attributes.position.needsUpdate = true;
    this.fillGeo.attributes.position.needsUpdate = true;
  }

  _onMouseMove(e) {
    if (!this.enabled) return;
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = new THREE.Vector3();
    const intersects = this.raycaster.ray.intersectPlane(this.groundPlane, hit);

    if (!intersects) {
      this._hide();
      return;
    }

    // Check if within grid bounds
    if (hit.x < 0 || hit.x > this.room.width || hit.z < 0 || hit.z > this.room.height) {
      this._hide();
      return;
    }

    // Snap to center of nearest unit
    const ux = Math.floor(hit.x) + 0.5;
    const uz = Math.floor(hit.z) + 0.5;

    // Clamp so the pulse zone stays within bounds
    this.centerX = Math.max(this.pulseSize / 2, Math.min(this.room.width - this.pulseSize / 2, ux));
    this.centerZ = Math.max(this.pulseSize / 2, Math.min(this.room.height - this.pulseSize / 2, uz));

    this.root.position.x = this.centerX;
    this.root.position.z = this.centerZ;

    if (!this.hovering) {
      this.hovering = true;
      this.root.visible = true;
      this.plusMat.opacity = this.ringOpacity;
      this.lastTime = performance.now();
      this.intervalTimer = this.interval; // trigger first pulse immediately
    }
  }

  _onMouseLeave() {
    this._hide();
  }

  _hide() {
    this.hovering = false;
    this.pulsing = false;
    this.intervalTimer = 0;
    this.group.visible = false;
    this.root.visible = false;
  }

  /** Disable cursor effects (e.g. during select state). */
  disable() {
    this.enabled = false;
    this._hide();
  }

  /** Re-enable cursor effects. */
  enable() {
    this.enabled = true;
  }

  /**
   * Call every frame from the render loop.
   */
  update() {
    if (!this.enabled || !this.hovering) return;

    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (this.pulsing) {
      // Animate the active pulse
      this.elapsed += dt;
      const progress = Math.min(1, this.elapsed / this.pulsePeriod);

      // Eased progress — fast start, slow end
      const eased = 1 - Math.pow(1 - progress, 2);

      const half = this.pulseSize / 2;
      const maxRadius = half * Math.SQRT2;
      const minRadius = maxRadius * this.pulseStart;
      const radius = minRadius + eased * (maxRadius - minRadius);

      this._updateRingShape(radius, this.elapsed);

      // Opacity: fade in quickly, fade out at the end
      const fadeIn  = Math.min(1, progress * 5);
      const fadeOut = Math.max(0, 1 - Math.pow(progress, 3));
      const opacity = fadeIn * fadeOut;

      this.ringMat.opacity = opacity * this.ringOpacity;
      this.fillMat.opacity = opacity * this.fillOpacity;

      // Pulse finished
      if (progress >= 1) {
        this.pulsing = false;
        this.group.visible = false;
        this.intervalTimer = 0;
      }
    } else {
      // Wait for next interval
      this.intervalTimer += dt;
      if (this.intervalTimer >= this.interval) {
        this.pulsing = true;
        this.elapsed = 0;
        this.group.visible = true;
      }
    }
  }
}
