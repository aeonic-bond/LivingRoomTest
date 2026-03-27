/**
 * EditingObjectMenu
 *
 * Context menu for editing a selected furniture item.
 * Shows color swatches from FurnitureConfig.colorOptions.
 * Appears on enter:selected, hides on exit:selected.
 */

class EditingObjectMenu {
  /**
   * @param {HTMLElement} container
   * @param {StateController} state
   * @param {THREE.OrthographicCamera} camera
   * @param {HTMLCanvasElement} canvas
   * @param {SceneData} sceneData
   * @param {SceneController} sceneCtrl
   * @param {Object} room
   */
  constructor(container, state, camera, canvas, sceneData, sceneCtrl, room) {
    this.container = container;
    this.state     = state;
    this.camera    = camera;
    this.canvas    = canvas;
    this.sceneData = sceneData;
    this.sceneCtrl = sceneCtrl;
    this.room      = room;

    this._itemId = null;

    this._buildDOM();
    this._bindState();
  }

  _buildDOM() {
    this.el = document.createElement('div');
    this.el.className = 'editing-object-menu';
    this.el.style.display = 'none';

    // Title
    this._titleEl = document.createElement('div');
    this._titleEl.className = 'eom-title';
    this.el.appendChild(this._titleEl);

    // Options container (rows go here)
    this._optionsEl = document.createElement('div');
    this._optionsEl.className = 'eom-options';
    this.el.appendChild(this._optionsEl);

    // Actions row
    const actionsEl = document.createElement('div');
    actionsEl.className = 'eom-actions';
    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'eom-delete';
    deleteBtn.innerHTML = '&#x1D5F;'; // trash unicode placeholder
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._onDelete();
    });
    actionsEl.appendChild(deleteBtn);
    this.el.appendChild(actionsEl);

    this.container.appendChild(this.el);
  }

  _bindState() {
    this.state.on('enter:selected', (data) => {
      if (data && data.itemId != null) this.show(data.itemId);
    });
    this.state.on('enter:default', () => {
      this.hide();
      this._lockedItemId = null;
    });
    this.state.on('enter:placing_child', () => {
      this.hide();
    });
  }

  _worldToScreen(wx, wz) {
    const v = new THREE.Vector3(wx, 0, wz);
    v.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width,
      y: (-v.y + 1) / 2 * rect.height,
    };
  }

  show(itemId) {
    this._itemId = itemId;
    const item = this.sceneData.get(itemId);
    if (!item) return;
    const config = FURNITURE[item.type];
    if (!config) return;

    // Title
    this._titleEl.textContent = config.label;

    // Rebuild option rows
    this._optionsEl.innerHTML = '';
    if (config.colorOptions) {
      for (const row of config.colorOptions.rows) {
        this._optionsEl.appendChild(this._buildOptionRow(row, item));
      }
    }

    // Lock entire position on first show for this item — stays fixed until DEFAULT
    if (this._lockedItemId !== itemId) {
      const itemScreen = this._worldToScreen(item.x, item.z);
      const gridCenterScreen = this._worldToScreen(this.room.width / 2, this.room.height / 2);
      const fromLeft = itemScreen.x < gridCenterScreen.x;

      const leftEdge  = this._worldToScreen(0, this.room.height / 2);
      const rightEdge = this._worldToScreen(this.room.width, this.room.height / 2);
      const gap = 24;
      const mw = 220;

      this.el.classList.remove('from-left', 'from-right', 'hidden');
      this.el.style.removeProperty('left');
      this.el.style.removeProperty('right');
      this.el.style.removeProperty('top');
      this.el.style.removeProperty('bottom');

      if (fromLeft) {
        this.el.style.left = (leftEdge.x - mw - gap) + 'px';
        this.el.classList.add('from-left');
      } else {
        this.el.style.left = (rightEdge.x + gap) + 'px';
        this.el.classList.add('from-right');
      }

      this.el.classList.add('hidden');
      this.el.style.display = 'flex';

      // Vertical position
      const ch = this.container.clientHeight;
      const mh = this.el.offsetHeight;
      const pad = 8;
      const offset = 24;
      const yPct = itemScreen.y / ch;

      if (yPct >= 0.45 && yPct <= 0.55) {
        this.el.style.top = Math.max(pad, Math.min(ch - mh - pad, itemScreen.y - mh / 2)) + 'px';
      } else if (yPct < 0.45) {
        this.el.style.top = Math.max(pad, Math.min(ch - mh - pad, itemScreen.y - offset)) + 'px';
      } else {
        this.el.style.bottom = Math.max(pad, Math.min(ch - mh - pad, ch - itemScreen.y - offset)) + 'px';
      }

      this.el.offsetHeight;
      this.el.classList.remove('hidden');

      this._lockedItemId = itemId;
    }

    if (this._hideTimeout) { clearTimeout(this._hideTimeout); this._hideTimeout = null; }
  }

  hide() {
    if (this._hideTimeout) clearTimeout(this._hideTimeout);
    this.el.classList.add('hidden');
    this._hideTimeout = setTimeout(() => {
      this.el.style.display = 'none';
      this._hideTimeout = null;
    }, 350);
    this._itemId = null;
  }

  _buildOptionRow(row, item) {
    const rowEl = document.createElement('div');
    rowEl.className = 'eom-option-row';

    // Label: "Fabric · Parchment"
    const labelEl = document.createElement('div');
    labelEl.className = 'eom-option-label';

    const catSpan = document.createElement('span');
    catSpan.textContent = row.label;
    labelEl.appendChild(catSpan);

    const activeOpt = row.options.find(o => o.id === item.colorId) || row.options[0];
    if (activeOpt) {
      const dot = document.createElement('span');
      dot.className = 'eom-dot';
      dot.textContent = '·';
      labelEl.appendChild(dot);

      const valSpan = document.createElement('span');
      valSpan.textContent = activeOpt.label;
      valSpan.className = 'eom-option-value';
      labelEl.appendChild(valSpan);
    }

    rowEl.appendChild(labelEl);

    // Swatch grid
    const swatchGrid = document.createElement('div');
    swatchGrid.className = 'eom-swatch-grid';

    for (const opt of row.options) {
      const swatch = document.createElement('div');
      swatch.className = 'eom-swatch';

      const circle = document.createElement('div');
      circle.className = 'eom-swatch-circle';
      circle.style.backgroundColor = '#' + opt.swatch.toString(16).padStart(6, '0');

      if (opt.id === (item.colorId || row.options[0].id)) {
        swatch.classList.add('eom-swatch-active');
      }

      swatch.appendChild(circle);
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        this._onColorSelect(opt.id);
      });
      swatchGrid.appendChild(swatch);
    }

    rowEl.appendChild(swatchGrid);
    return rowEl;
  }

  _onColorSelect(colorId) {
    if (this._itemId == null) return;
    const item = this.sceneData.get(this._itemId);
    if (!item) return;

    // Update data
    this.sceneData.update(this._itemId, { colorId });

    // Rebuild mesh with new color
    this.sceneCtrl._removeMesh(item);
    this.sceneCtrl._addMesh(item);
    this.sceneCtrl.selectItem(this._itemId);

    // Refresh the menu to update active swatch
    this.show(this._itemId);
  }

  _onDelete() {
    if (this._itemId == null) return;
    this.sceneData.remove(this._itemId);
    this.state.set(STATES.DEFAULT);
  }
}
