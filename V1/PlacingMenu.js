/**
 * PlacingMenu
 *
 * Context menu for choosing a furniture type to place.
 * Derives items from FurnitureConfig.js.
 * Listens to StateController for enter:placing / exit:placing.
 */

class PlacingMenu {
  /**
   * @param {HTMLElement} container
   * @param {StateController} state
   * @param {THREE.OrthographicCamera} camera
   * @param {HTMLCanvasElement} canvas
   * @param {PulseController} pulse
   * @param {EdgeAffinity} edges
   * @param {SceneData} sceneData
   * @param {Object} room
   * @param {CornerAffinity} corners
   */
  constructor(container, state, camera, canvas, pulse, edges, sceneData, room, corners) {
    this.container = container;
    this.state     = state;
    this.camera    = camera;
    this.canvas    = canvas;
    this.pulse     = pulse;
    this.edges     = edges;
    this.corners   = corners;
    this.sceneData = sceneData;
    this.room      = room;

    this._buildDOM();
    this._bindState();
  }

  _buildDOM() {
    this.el = document.createElement('div');
    this.el.className = 'placing-menu';
    this.el.style.display = 'none';

    FURNITURE_ORDER.forEach(id => {
      const type = FURNITURE[id];
      const row = document.createElement('div');
      row.className = 'placing-menu-item';

      const icon = document.createElement('div');
      icon.className = 'placing-menu-icon';

      const label = document.createElement('span');
      label.className = 'placing-menu-label';
      label.textContent = type.label;

      row.appendChild(icon);
      row.appendChild(label);

      row.addEventListener('mouseenter', () => this._onHover(type.id));
      row.addEventListener('mouseleave', () => this._onHoverEnd());
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this._onSelect(type.id);
      });

      this.el.appendChild(row);
    });

    this.container.appendChild(this.el);
  }

  _bindState() {
    this.state.on('enter:placing', (data) => this.show(data));
    this.state.on('exit:placing', () => this.hide());
  }

  /**
   * Convert world coords to screen position within the container.
   */
  _worldToScreen(wx, wz) {
    const v = new THREE.Vector3(wx, 0, wz);
    v.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width,
      y: (-v.y + 1) / 2 * rect.height,
    };
  }

  show(data) {
    // Determine slide direction based on click position relative to grid center
    const gridCenterScreen = this._worldToScreen(this.room.width / 2, this.room.height / 2);
    const clickScreen = this._worldToScreen(data.x, data.z);
    const fromLeft = clickScreen.x < gridCenterScreen.x;

    // Get grid edge positions in screen space
    const leftEdge  = this._worldToScreen(0, this.room.height / 2);
    const rightEdge = this._worldToScreen(this.room.width, this.room.height / 2);
    const gap = 24; // --spacer-700
    const mw = 220; // menu width

    // Reset
    // Cancel any pending hide
    if (this._hideTimeout) { clearTimeout(this._hideTimeout); this._hideTimeout = null; }

    this.el.classList.remove('from-left', 'from-right', 'hidden');
    this.el.style.removeProperty('left');
    this.el.style.removeProperty('right');

    // Position relative to grid edge
    if (fromLeft) {
      const restX = leftEdge.x - mw - gap;
      this.el.style.left = restX + 'px';
      this.el.classList.add('from-left');
    } else {
      const restX = rightEdge.x + gap;
      this.el.style.left = restX + 'px';
      this.el.classList.add('from-right');
    }

    this.el.classList.add('hidden');
    this.el.style.display = 'flex';

    // Vertical position: align top or bottom to click height
    const ch = this.container.clientHeight;
    const mh = this.el.offsetHeight;
    const pad = 8;

    this.el.style.removeProperty('top');
    this.el.style.removeProperty('bottom');

    const offset = 24; // --spacer-700
    const yPct = clickScreen.y / ch;

    if (yPct >= 0.45 && yPct <= 0.55) {
      // Mid — center menu on click
      const top = Math.max(pad, Math.min(ch - mh - pad, clickScreen.y - mh / 2));
      this.el.style.top = top + 'px';
    } else if (yPct < 0.45) {
      // Top half — menu top above click
      const top = Math.max(pad, Math.min(ch - mh - pad, clickScreen.y - offset));
      this.el.style.top = top + 'px';
    } else {
      // Bottom half — menu bottom below click
      const bottom = Math.max(pad, Math.min(ch - mh - pad, ch - clickScreen.y - offset));
      this.el.style.bottom = bottom + 'px';
    }

    // Force reflow, then slide in
    this.el.offsetHeight;
    this.el.classList.remove('hidden');
  }

  hide() {
    // Cancel any pending hide timeout
    if (this._hideTimeout) clearTimeout(this._hideTimeout);

    this.el.classList.add('hidden');
    // Use timeout as fallback in case transitionend doesn't fire
    this._hideTimeout = setTimeout(() => {
      this.el.style.display = 'none';
      this._hideTimeout = null;
    }, 350); // slightly longer than the CSS transition (300ms)
  }

  _onHover(typeId) {
    const config = FURNITURE[typeId];
    if (!config) return;

    const data = this.state.data;
    if (!data) return;

    const fp  = config.footprint;
    const buf = config.buffer;

    if (fp.type === 'L') {
      // L-shape: compute blocks from hinge + thrusts + corner directions
      const result = this.corners.getNearestCorner(data.x, data.z);
      if (!result) return;

      const { majorDir, minorDir } = result;
      const h = fp.hinge;

      // Hinge block at origin (with buffer on all sides)
      const hingeBlock = {
        x: -buf, z: -buf,
        w: h.w + buf * 2,
        d: h.d + buf * 2,
      };

      // Hinge edges (with buffer)
      const hx0 = -buf, hz0 = -buf;
      const hx1 = h.w + buf, hz1 = h.d + buf;

      // Major arm: starts flush at hinge edge, extends thrust + buffer outward
      const majorBlock = {
        x: majorDir.x > 0 ? hx1 : majorDir.x < 0 ? hx0 - (fp.majorThrust + buf) : hx0,
        z: majorDir.z > 0 ? hz1 : majorDir.z < 0 ? hz0 - (fp.majorThrust + buf) : hz0,
        w: Math.abs(majorDir.x) > 0 ? fp.majorThrust + buf : hx1 - hx0,
        d: Math.abs(majorDir.z) > 0 ? fp.majorThrust + buf : hz1 - hz0,
      };

      // Minor arm: starts flush at hinge edge, extends thrust + buffer outward
      const minorBlock = {
        x: minorDir.x > 0 ? hx1 : minorDir.x < 0 ? hx0 - (fp.minorThrust + buf) : hx0,
        z: minorDir.z > 0 ? hz1 : minorDir.z < 0 ? hz0 - (fp.minorThrust + buf) : hz0,
        w: Math.abs(minorDir.x) > 0 ? fp.minorThrust + buf : hx1 - hx0,
        d: Math.abs(minorDir.z) > 0 ? fp.minorThrust + buf : hz1 - hz0,
      };

      const blocks = [hingeBlock, majorBlock, minorBlock];

      this.pulse.setConfig({
        pulseVariant: 'lShape',
        pulseBlocks:  blocks,
        pulseHinge:   hingeBlock,
        rotation:     0,
      });
    } else {
      // Rectangle footprint
      let rotation = 0;
      if (config.affinity === 'edge') {
        const edge = this.edges.getNearestEdge(data.x, data.z);
        rotation = edge ? this.edges.getRotation(edge) : 0;
      }

      this.pulse.setConfig({
        pulseVariant: 'default',
        pulseBlocks:  null,
        pulseHinge:   null,
        pulseW:       fp.w + buf * 2,
        pulseD:       fp.d + buf * 2,
        rotation:     rotation,
      });
    }

    // Calculate where plus currently is in world space
    const oldWorldX = this.pulse.group.position.x + this.pulse.plusGroup.position.x;
    const oldWorldZ = this.pulse.group.position.z + this.pulse.plusGroup.position.z;

    if (fp.type === 'L') {
      // L-shape: find how far the blocks extend from hinge in each direction
      const blocks = this.pulse.pulseBlocks;
      const hx = this.pulse._hingeOffX;
      const hz = this.pulse._hingeOffZ;
      let extMinX = 0, extMaxX = 0, extMinZ = 0, extMaxZ = 0;
      for (const b of blocks) {
        extMinX = Math.min(extMinX, b.x - hx);
        extMaxX = Math.max(extMaxX, b.x + b.w - hx);
        extMinZ = Math.min(extMinZ, b.z - hz);
        extMaxZ = Math.max(extMaxZ, b.z + b.d - hz);
      }
      // Clamp hinge position so all blocks stay within room
      const ox = Math.max(-extMinX, Math.min(this.room.width - extMaxX, data.x));
      const oz = Math.max(-extMinZ, Math.min(this.room.height - extMaxZ, data.z));

      this.pulse.centerX = ox;
      this.pulse.centerZ = oz;
      this.pulse.group.position.x = ox;
      this.pulse.group.position.z = oz;
    } else {
      // Rect: adjust origin to keep pulse in room
      const o = this.pulse._adjustOrigin(data.x, data.z);
      this.pulse.centerX = o.x;
      this.pulse.centerZ = o.z;
      this.pulse.group.position.x = o.x;
      this.pulse.group.position.z = o.z;
    }

    // Set plus to its old world position relative to new group position
    this.pulse.plusGroup.position.x = oldWorldX - this.pulse.group.position.x;
    this.pulse.plusGroup.position.z = oldWorldZ - this.pulse.group.position.z;

    // Animate plus to new center (hinge for L-shape, adjusted center for rect)
    this.pulse.animatePlus(0, 0);
    this.pulse.trigger();
  }

  _onHoverEnd() {
    this.pulse.resetConfig();

    const data = this.state.data;
    if (data) {
      const o = this.pulse._adjustOrigin(data.x, data.z);

      // Calculate where plus currently is in world space
      const oldWorldX = this.pulse.group.position.x + this.pulse.plusGroup.position.x;
      const oldWorldZ = this.pulse.group.position.z + this.pulse.plusGroup.position.z;

      // Move group to new origin
      this.pulse.centerX = o.x;
      this.pulse.centerZ = o.z;
      this.pulse.group.position.x = o.x;
      this.pulse.group.position.z = o.z;

      // Set plus to its old world position relative to new group position
      this.pulse.plusGroup.position.x = oldWorldX - o.x;
      this.pulse.plusGroup.position.z = oldWorldZ - o.z;

      // Animate plus back to click offset
      this.pulse.animatePlus(data.x - o.x, data.z - o.z);
    }
  }

  _onSelect(typeId) {
    const data = this.state.data;
    if (!data) return;

    const config = FURNITURE[typeId];
    const edge = config.affinity === 'edge'
      ? this.edges.getNearestEdge(data.x, data.z)
      : null;
    const rotation = edge ? this.edges.getRotation(edge) : 0;

    const item = this.sceneData.add({
      type:     typeId,
      x:        data.x,
      z:        data.z,
      rotation: rotation,
      edgeId:   edge ? edge.id : null,
    });

    this.state.set(STATES.SELECTED, { itemId: item.id });
  }
}
