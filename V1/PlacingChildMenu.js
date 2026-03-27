/**
 * PlacingChildMenu
 *
 * Context menu for choosing a child furniture type to place in a slot.
 * Shows only the parent's allowedChildren.
 * Listens to StateController for enter:placing_child / exit:placing_child.
 */

class PlacingChildMenu {
  /**
   * @param {HTMLElement} container
   * @param {StateController} state
   * @param {THREE.OrthographicCamera} camera
   * @param {HTMLCanvasElement} canvas
   * @param {SceneData} sceneData
   * @param {Object} room
   */
  constructor(container, state, camera, canvas, sceneData, room, edges) {
    this.container = container;
    this.state     = state;
    this.camera    = camera;
    this.canvas    = canvas;
    this.sceneData = sceneData;
    this.room      = room;
    this.edges     = edges;

    this._buildDOM();
    this._bindState();
  }

  _buildDOM() {
    this.el = document.createElement('div');
    this.el.className = 'placing-menu';
    this.el.style.display = 'none';
    this.container.appendChild(this.el);
  }

  _bindState() {
    this.state.on('enter:placing_child', (data) => this.show(data));
    this.state.on('exit:placing_child', () => this.hide());
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

  /**
   * Populate menu items from the parent's allowedChildren.
   */
  _populateItems(parentType) {
    // Clear previous items
    this.el.innerHTML = '';

    const config = FURNITURE[parentType];
    if (!config || !config.allowedChildren) return;

    config.allowedChildren.forEach(childId => {
      const childConfig = FURNITURE[childId];
      if (!childConfig) return;

      const row = document.createElement('div');
      row.className = 'placing-menu-item';

      const icon = document.createElement('div');
      icon.className = 'placing-menu-icon';

      const label = document.createElement('span');
      label.className = 'placing-menu-label';
      label.textContent = childConfig.label;

      row.appendChild(icon);
      row.appendChild(label);

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this._onSelect(childId);
      });

      this.el.appendChild(row);
    });
  }

  show(data) {
    if (!data) return;
    this._parentId = data.parentId;
    this._slotId   = data.slotId;

    const parentItem = this.sceneData.get(data.parentId);
    if (!parentItem) return;

    this._populateItems(parentItem.type);

    // Position same as PlacingMenu: slide from nearest grid edge
    const gridCenterScreen = this._worldToScreen(this.room.width / 2, this.room.height / 2);
    const clickScreen = this._worldToScreen(data.x, data.z);
    const fromLeft = clickScreen.x < gridCenterScreen.x;

    const leftEdge  = this._worldToScreen(0, this.room.height / 2);
    const rightEdge = this._worldToScreen(this.room.width, this.room.height / 2);
    const gap = 24;
    const mw = 220;

    if (this._hideTimeout) { clearTimeout(this._hideTimeout); this._hideTimeout = null; }

    this.el.classList.remove('from-left', 'from-right', 'hidden');
    this.el.style.removeProperty('left');
    this.el.style.removeProperty('right');

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

    // Vertical position
    const ch = this.container.clientHeight;
    const mh = this.el.offsetHeight;
    const pad = 8;
    const offset = 24;

    this.el.style.removeProperty('top');
    this.el.style.removeProperty('bottom');

    const yPct = clickScreen.y / ch;
    if (yPct >= 0.45 && yPct <= 0.55) {
      const top = Math.max(pad, Math.min(ch - mh - pad, clickScreen.y - mh / 2));
      this.el.style.top = top + 'px';
    } else if (yPct < 0.45) {
      const top = Math.max(pad, Math.min(ch - mh - pad, clickScreen.y - offset));
      this.el.style.top = top + 'px';
    } else {
      const bottom = Math.max(pad, Math.min(ch - mh - pad, ch - clickScreen.y - offset));
      this.el.style.bottom = bottom + 'px';
    }

    // Force reflow, then slide in
    this.el.offsetHeight;
    this.el.classList.remove('hidden');
  }

  hide() {
    if (this._hideTimeout) clearTimeout(this._hideTimeout);
    this.el.classList.add('hidden');
    this._hideTimeout = setTimeout(() => {
      this.el.style.display = 'none';
      this._hideTimeout = null;
    }, 350);
  }

  _onSelect(childTypeId) {
    const parentItem = this.sceneData.get(this._parentId);
    if (!parentItem) return;

    const parentConfig = FURNITURE[parentItem.type];
    const slotConfig = parentConfig.slots.find(s => s.id === this._slotId);

    // Adjust parent position so the child fits within room bounds
    if (slotConfig) {
      this._adjustParentForChild(parentItem, childTypeId, slotConfig);
    }

    this.sceneData.add({
      type:     childTypeId,
      x:        0,
      z:        0,
      rotation: 0,
      parentId: this._parentId,
      slotId:   this._slotId,
    });

    // Back to selected state with the parent still selected
    this.state.set(STATES.SELECTED, { itemId: this._parentId });
  }

  /**
   * If placing this child would be blocked, shift the parent along its edge
   * until the child clears. Uses isSlotBlocked for the same check as
   * slot indicators and child visibility.
   */
  _adjustParentForChild(parentItem, childType, slotConfig) {
    if (parentItem.edgeId == null) return;
    const edge = this.edges.getEdge(parentItem.edgeId);
    if (!edge) return;

    const rot = parentItem.rotation || 0;
    const cosR = Math.abs(Math.cos(rot));
    const sinR = Math.abs(Math.sin(rot));
    const isHorizontal = Math.abs(edge.normal.z) > Math.abs(edge.normal.x);

    const childFp = FURNITURE[childType].footprint;
    const halfW = (childFp.w * cosR + childFp.d * sinR) / 2;
    const halfD = (childFp.w * sinR + childFp.d * cosR) / 2;

    // Check if child is already clear
    const childPos = getSlotWorldPosition(parentItem, slotConfig, childType);
    if (!isSlotBlocked(childPos, halfW, halfD, parentItem.id, this.room, this.sceneData)) return;

    // Binary-ish search: shift parent along slide axis in small steps until child clears
    const step = 0.1;
    const maxShift = isHorizontal ? this.room.width : this.room.height;

    // Determine shift direction: move parent away from the room edge the child is near
    const childSlidePos = isHorizontal ? childPos.x : childPos.z;
    const roomMax = isHorizontal ? this.room.width : this.room.height;
    const dir = childSlidePos < roomMax / 2 ? 1 : -1;

    for (let s = step; s < maxShift; s += step) {
      const testParent = { ...parentItem };
      if (isHorizontal) testParent.x = parentItem.x + dir * s;
      else testParent.z = parentItem.z + dir * s;

      const testPos = getSlotWorldPosition(testParent, slotConfig, childType);
      if (!isSlotBlocked(testPos, halfW, halfD, parentItem.id, this.room, this.sceneData)) {
        this.sceneData.update(parentItem.id,
          isHorizontal ? { x: testParent.x } : { z: testParent.z }
        );
        return;
      }
    }
  }
}
