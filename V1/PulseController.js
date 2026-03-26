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
    this.pulseSize    = 3;       // default square size (used when pulseW/pulseD are null)
    this.pulseW       = null;    // override width (set by furniture footprint)
    this.pulseD       = null;    // override depth (set by furniture footprint)
    this.rotation     = 0;       // radians (from EdgeAffinity, determines axis mapping)
    this.pulseVariant = 'default'; // 'default' or 'lShape'
    this.pulseBlocks  = null;    // array of { x, z, w, d } for lShape
    this.pulseHinge   = null;    // { x, z, w, d } hinge block for lShape
    this.pulsePeriod  = 1;       // seconds per cycle
    this.interval     = 0.4;     // seconds between pulse starts
    this.pulseNoise   = 0;       // wobble intensity (0 = perfect circle)
    this.pulseStart   = 0.3;     // starting radius fraction

    // Internal
    this._hingeOffX    = 0;
    this._hingeOffZ    = 0;

    // State
    this.active        = false;
    this.anchored      = false;
    this.centerX       = 0;
    this.centerZ       = 0;
    this.rawX          = 0;
    this.rawZ          = 0;
    this.elapsed       = 0;
    this.intervalTimer = 0;
    this.pulsing       = false;
    this.lastTime      = 0;

    // Plus tween (only active during PLACING hover transitions)
    this._plusTween     = null;  // { startX, startZ, endX, endZ, duration, elapsed }

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

    // L-shape arm rectangles (hidden by default, only used in lShape mode)
    this.lGroup = new THREE.Group();
    this.lGroup.visible = false;
    this.lGroup.position.y = 0.003;

    const lFillMat = () => new THREE.MeshBasicMaterial({
      color: this.fillColor, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const lStrokeMat = () => new THREE.LineBasicMaterial({
      color: this.strokeColor, transparent: true, opacity: 0,
    });

    // Hinge fill (always shown at full size when L is active)
    this.lHingeFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), lFillMat());
    this.lHingeFill.rotation.x = -Math.PI / 2;
    this.lGroup.add(this.lHingeFill);

    this.lHingeOutlineGeo = new THREE.BufferGeometry();
    this.lHingeOutlineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(5 * 3), 3));
    this.lHingeOutline = new THREE.Line(this.lHingeOutlineGeo, lStrokeMat());
    this.lGroup.add(this.lHingeOutline);

    // Major arm fill + outline
    this.lMajorFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), lFillMat());
    this.lMajorFill.rotation.x = -Math.PI / 2;
    this.lGroup.add(this.lMajorFill);

    this.lMajorOutlineGeo = new THREE.BufferGeometry();
    this.lMajorOutlineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(5 * 3), 3));
    this.lMajorOutline = new THREE.Line(this.lMajorOutlineGeo, lStrokeMat());
    this.lGroup.add(this.lMajorOutline);

    // Minor arm fill + outline
    this.lMinorFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), lFillMat());
    this.lMinorFill.rotation.x = -Math.PI / 2;
    this.lGroup.add(this.lMinorFill);

    this.lMinorOutlineGeo = new THREE.BufferGeometry();
    this.lMinorOutlineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(5 * 3), 3));
    this.lMinorOutline = new THREE.Line(this.lMinorOutlineGeo, lStrokeMat());
    this.lGroup.add(this.lMinorOutline);

    this.group.add(this.lGroup);
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

  /**
   * Update L-shape arms. Each arm is a rectangle growing from the hinge outward.
   * @param {number} progress - 0 to 1 eased animation progress
   * @param {number} opacity - current fade opacity
   */
  _updateLShape(progress, opacity) {
    if (!this.pulseBlocks || this.pulseBlocks.length < 3) return;

    const hinge = this.pulseBlocks[0];
    const major = this.pulseBlocks[1];
    const minor = this.pulseBlocks[2];
    const hx = this._hingeOffX;
    const hz = this._hingeOffZ;

    // Helper: set a rect outline
    const setOutline = (geo, x0, z0, x1, z1) => {
      const pos = geo.attributes.position.array;
      pos[0]=x0; pos[1]=0; pos[2]=z0;
      pos[3]=x1; pos[4]=0; pos[5]=z0;
      pos[6]=x1; pos[7]=0; pos[8]=z1;
      pos[9]=x0; pos[10]=0; pos[11]=z1;
      pos[12]=x0; pos[13]=0; pos[14]=z0;
      geo.attributes.position.needsUpdate = true;
    };

    // Hinge: always full size
    const hx0 = hinge.x - hx, hz0 = hinge.z - hz;
    const hx1 = hx0 + hinge.w, hz1 = hz0 + hinge.d;
    this.lHingeFill.scale.set(hinge.w, hinge.d, 1);
    this.lHingeFill.position.set((hx0 + hx1) / 2, 0, (hz0 + hz1) / 2);
    setOutline(this.lHingeOutlineGeo, hx0, hz0, hx1, hz1);

    // Helper: update arm — grows from hinge edge outward
    const updateArm = (block, fillMesh, outlineGeo) => {
      const bx0 = block.x - hx;
      const bz0 = block.z - hz;
      const bx1 = bx0 + block.w;
      const bz1 = bz0 + block.d;

      // Find which edge is the hinge-facing edge by checking adjacency
      // The hinge-facing edge is the one closest to the hinge center (0,0)
      const distLeft  = Math.abs(bx0);
      const distRight = Math.abs(bx1);
      const distTop   = Math.abs(bz0);
      const distBot   = Math.abs(bz1);

      // Thrust axis: the axis where the block extends further from hinge
      const xRange = Math.max(distLeft, distRight);
      const zRange = Math.max(distTop, distBot);
      const thrustX = xRange > zRange;

      let ax0, az0, ax1, az1;
      if (thrustX) {
        // Thrust along x — full depth, grow x from hinge edge outward
        az0 = bz0;
        az1 = bz1;
        if (distLeft < distRight) {
          // Hinge is on left, grow rightward
          ax0 = bx0;
          ax1 = bx0 + block.w * progress;
        } else {
          // Hinge is on right, grow leftward
          ax1 = bx1;
          ax0 = bx1 - block.w * progress;
        }
      } else {
        // Thrust along z — full width, grow z from hinge edge outward
        ax0 = bx0;
        ax1 = bx1;
        if (distTop < distBot) {
          // Hinge is on top, grow downward
          az0 = bz0;
          az1 = bz0 + block.d * progress;
        } else {
          // Hinge is on bottom, grow upward
          az1 = bz1;
          az0 = bz1 - block.d * progress;
        }
      }

      const w = Math.max(0.001, ax1 - ax0);
      const d = Math.max(0.001, az1 - az0);
      fillMesh.scale.set(w, d, 1);
      fillMesh.position.set((ax0 + ax1) / 2, 0, (az0 + az1) / 2);
      setOutline(outlineGeo, ax0, az0, ax1, az1);
    };

    updateArm(major, this.lMajorFill, this.lMajorOutlineGeo);
    updateArm(minor, this.lMinorFill, this.lMinorOutlineGeo);

    // Opacity
    this.lHingeFill.material.opacity = opacity * this.fillOpacity;
    this.lHingeOutline.material.opacity = opacity * this.ringOpacity;
    this.lMajorFill.material.opacity = opacity * this.fillOpacity;
    this.lMinorFill.material.opacity = opacity * this.fillOpacity;
    this.lMajorOutline.material.opacity = opacity * this.ringOpacity;
    this.lMinorOutline.material.opacity = opacity * this.ringOpacity;
  }

  _updateRingShape(radius, time) {
    const ringPos = this.ringGeo.attributes.position.array;
    const fillPos = this.fillGeo.attributes.position.array;
    const n = this.ringResolution;
    const { halfX, halfZ } = this._getHalfExtents();

    // Clamp bounds: pulse box AND room edges
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
    let halfX, halfZ;

    if (this.pulseVariant === 'lShape' && this.pulseBlocks) {
      // Compute extent from blocks relative to hinge
      let maxX = 0, maxZ = 0;
      for (const block of this.pulseBlocks) {
        maxX = Math.max(maxX, Math.abs(block.x - this._hingeOffX), Math.abs(block.x + block.w - this._hingeOffX));
        maxZ = Math.max(maxZ, Math.abs(block.z - this._hingeOffZ), Math.abs(block.z + block.d - this._hingeOffZ));
      }
      halfX = maxX;
      halfZ = maxZ;
    } else {
      const ext = this._getHalfExtents();
      halfX = ext.halfX;
      halfZ = ext.halfZ;
    }

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
   * Animate plus from its current position to a target offset within the group.
   * @param {number} targetX - target x offset relative to group
   * @param {number} targetZ - target z offset relative to group
   * @param {number} [duration=0.25] - seconds
   */
  animatePlus(targetX, targetZ, duration = 0.25) {
    this._plusTween = {
      startX:  this.plusGroup.position.x,
      startZ:  this.plusGroup.position.z,
      endX:    targetX,
      endZ:    targetZ,
      duration: duration,
      elapsed: 0,
    };
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
    this.lGroup.visible = false;
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
    if (config.pulseVariant !== undefined) this.pulseVariant = config.pulseVariant;
    if (config.pulseBlocks !== undefined) {
      this.pulseBlocks = config.pulseBlocks;
      // Precompute hinge center offset for block clamping
      if (config.pulseHinge) {
        this.pulseHinge = config.pulseHinge;
        this._hingeOffX = config.pulseHinge.x + config.pulseHinge.w / 2;
        this._hingeOffZ = config.pulseHinge.z + config.pulseHinge.d / 2;
      }
    }
    if (config.pulseHinge !== undefined && !config.pulseBlocks) {
      this.pulseHinge = config.pulseHinge;
      if (config.pulseHinge) {
        this._hingeOffX = config.pulseHinge.x + config.pulseHinge.w / 2;
        this._hingeOffZ = config.pulseHinge.z + config.pulseHinge.d / 2;
      }
    }
  }

  /**
   * Reset config to defaults.
   */
  resetConfig() {
    this.pulseSize    = 3;
    this.pulseW       = null;
    this.pulseD       = null;
    this.rotation     = 0;
    this.pulseVariant = 'default';
    this.pulseBlocks  = null;
    this.pulseHinge   = null;
    this._hingeOffX   = 0;
    this._hingeOffZ   = 0;
    this.pulsePeriod  = 1;
    this.interval     = 0.4;
    this.pulseNoise   = 0;
    this.pulseStart   = 0.3;
    this.fillColor    = new THREE.Color(0xffaacc);
    this.strokeColor  = PULSE_COLOR_DIVIDER;
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

      const fadeIn  = Math.min(1, progress * 5);
      const fadeOut = Math.max(0, 1 - Math.pow(progress, 3));
      const opacity = fadeIn * fadeOut;

      const isL = this.pulseVariant === 'lShape' && this.pulseBlocks;

      if (isL) {
        // L-shape: two rectangles growing from hinge
        this.ring.visible = false;
        this.fill.visible = false;
        this.lGroup.visible = true;
        this._updateLShape(eased, opacity);
      } else {
        // Default: circle expanding into rectangle
        this.ring.visible = true;
        this.fill.visible = true;
        this.lGroup.visible = false;

        const { halfX, halfZ } = this._getHalfExtents();
        const avgHalf = (halfX + halfZ) / 2;
        const maxRadius = avgHalf * Math.SQRT2;
        const minRadius = maxRadius * this.pulseStart;
        const radius = minRadius + eased * (maxRadius - minRadius);

        this._updateRingShape(radius, this.elapsed);

        this.ringMat.opacity = opacity * this.ringOpacity;
        this.fillMat.opacity = opacity * this.fillOpacity;
      }

      if (progress >= 1) {
        this.pulsing = false;
        this.ringMat.opacity = 0;
        this.fillMat.opacity = 0;
        if (isL) {
          this.lHingeFill.material.opacity = 0;
          this.lHingeOutline.material.opacity = 0;
          this.lMajorFill.material.opacity = 0;
          this.lMinorFill.material.opacity = 0;
          this.lMajorOutline.material.opacity = 0;
          this.lMinorOutline.material.opacity = 0;
        }
        this.intervalTimer = 0;
      }
    } else {
      this.intervalTimer += dt;
      if (this.intervalTimer >= this.interval) {
        this.pulsing = true;
        this.elapsed = 0;
      }
    }

    // Plus tween
    if (this._plusTween) {
      const tw = this._plusTween;
      tw.elapsed += dt;
      const t = Math.min(1, tw.elapsed / tw.duration);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      this.plusGroup.position.x = tw.startX + (tw.endX - tw.startX) * ease;
      this.plusGroup.position.z = tw.startZ + (tw.endZ - tw.startZ) * ease;
      if (t >= 1) this._plusTween = null;
    }
  }
}
