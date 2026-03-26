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
   */
  constructor(container, state, camera, canvas, pulse, edges, sceneData, room) {
    this.container = container;
    this.state     = state;
    this.camera    = camera;
    this.canvas    = canvas;
    this.pulse     = pulse;
    this.edges     = edges;
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
    this.el.classList.add('hidden');
    // Hide display after transition
    const onEnd = () => {
      this.el.style.display = 'none';
      this.el.removeEventListener('transitionend', onEnd);
    };
    this.el.addEventListener('transitionend', onEnd);
  }

  _onHover(typeId) {
    const config = FURNITURE[typeId];
    if (!config || config.affinity !== 'edge') return;

    const data = this.state.data;
    if (!data) return;

    const edge = this.edges.getNearestEdge(data.x, data.z);
    const rotation = edge ? this.edges.getRotation(edge) : 0;

    this.pulse.setConfig({
      pulseW:   config.footprint.w + config.buffer * 2,
      pulseD:   config.footprint.d + config.buffer * 2,
      rotation: rotation,
    });

    // Re-adjust origin for the new size and force a pulse
    const o = this.pulse._adjustOrigin(data.x, data.z);
    this.pulse.centerX = o.x;
    this.pulse.centerZ = o.z;
    this.pulse.group.position.x = o.x;
    this.pulse.group.position.z = o.z;
    this.pulse.plusGroup.position.x = data.x - o.x;
    this.pulse.plusGroup.position.z = data.z - o.z;
    this.pulse.trigger();
  }

  _onHoverEnd() {
    this.pulse.resetConfig();

    // Re-adjust origin back to default size
    const data = this.state.data;
    if (data) {
      const o = this.pulse._adjustOrigin(data.x, data.z);
      this.pulse.centerX = o.x;
      this.pulse.centerZ = o.z;
      this.pulse.group.position.x = o.x;
      this.pulse.group.position.z = o.z;
      this.pulse.plusGroup.position.x = data.x - o.x;
      this.pulse.plusGroup.position.z = data.z - o.z;
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
