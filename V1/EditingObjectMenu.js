/**
 * EditingObjectMenu
 *
 * Consolidated context menu for editing selected furniture.
 * Container of cards: Main (parent) + ChildSelecting or Child cards.
 *
 * States:
 *   SELECTED → shows Main card (color options, delete)
 *   PLACING_CHILD → shows Main card + ChildSelecting card (type picker)
 *   After child placed → shows Main card + Child card (child color options)
 */

class EditingObjectMenu {
  constructor(container, state, camera, canvas, sceneData, sceneCtrl, room, edges) {
    this.container = container;
    this.state     = state;
    this.camera    = camera;
    this.canvas    = canvas;
    this.sceneData = sceneData;
    this.sceneCtrl = sceneCtrl;
    this.room      = room;
    this.edges     = edges;

    this._itemId = null;
    this._lockedItemId = null;
    this._childGroupId = null;
    this._childParentId = null;

    this._buildDOM();
    this._bindState();
  }

  // ── DOM ──────────────────────────────────────────────────

  _buildDOM() {
    this.el = document.createElement('div');
    this.el.className = 'eom';
    this.el.style.display = 'none';

    // Cards get appended dynamically
    this._mainCardEl = null;
    this._childCardEl = null;
    this._childSelectingEl = null;

    this.container.appendChild(this.el);
  }

  // ── State binding ────────────────────────────────────────

  _bindState() {
    this.state.on('enter:selected', (data) => {
      if (data && data.itemId != null) this.show(data.itemId);
    });
    this.state.on('enter:placing_child', (data) => {
      if (data) this._showChildSelecting(data.parentId, data.groupId, data.subSlot);
    });
    this.state.on('enter:default', () => {
      this.hide();
      this._lockedItemId = null;
    });
  }

  // ── Positioning ──────────────────────────────────────────

  _worldToScreen(wx, wz) {
    const v = new THREE.Vector3(wx, 0, wz);
    v.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width,
      y: (-v.y + 1) / 2 * rect.height,
    };
  }

  _lockPosition(itemId) {
    if (this._lockedItemId === itemId) return;
    const item = this.sceneData.get(itemId);
    if (!item) return;

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

    // Pin to top of scene
    const topEdge = this._worldToScreen(this.room.width / 2, 0);
    this.el.style.top = topEdge.y + 'px';

    this.el.offsetHeight;
    this.el.classList.remove('hidden');

    this._lockedItemId = itemId;
  }

  // ── Show / Hide ──────────────────────────────────────────

  show(itemId) {
    this._itemId = itemId;
    const item = this.sceneData.get(itemId);
    if (!item) return;

    if (this._hideTimeout) { clearTimeout(this._hideTimeout); this._hideTimeout = null; }

    // Rebuild cards
    this.el.innerHTML = '';
    this._mainCardEl = this._buildItemCard(item);
    this.el.appendChild(this._mainCardEl);

    // Show child cards for placed children
    const config = FURNITURE[item.type];
    if (config && config.slotGroups) {
      for (const group of config.slotGroups) {
        const child = this.sceneData.getChildrenInSlotGroup(itemId, group.id)[0];
        if (child) {
          const childCard = this._buildItemCard(child);
          this.el.appendChild(childCard);
        }
      }
    }

    this._childSelectingEl = null;
    this._lockPosition(itemId);
  }

  _showChildSelecting(parentId, groupId, subSlot) {
    this._childParentId = parentId;
    this._childGroupId = groupId;
    this._childSubSlot = subSlot || 'back';

    const parentItem = this.sceneData.get(parentId);
    if (!parentItem) return;
    const config = FURNITURE[parentItem.type];
    if (!config || !config.allowedChildren) return;

    // Remove any existing child selecting card
    if (this._childSelectingEl) {
      this._childSelectingEl.remove();
      this._childSelectingEl = null;
    }

    // Build child selecting card
    const card = document.createElement('div');
    card.className = 'eom-card eom-card-child-selecting';

    // Title with X close button
    const title = document.createElement('div');
    title.className = 'eom-card-title';

    const titleText = document.createElement('span');
    titleText.textContent = 'Adding Side Piece...';
    title.appendChild(titleText);

    const closeBtn = document.createElement('div');
    closeBtn.className = 'eom-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.state.set(STATES.SELECTED, { itemId: parentId });
    });
    title.appendChild(closeBtn);

    card.appendChild(title);

    // Child type grid
    const typesEl = document.createElement('div');
    typesEl.className = 'eom-child-types';

    config.allowedChildren.forEach(childId => {
      const childConfig = FURNITURE[childId];
      if (!childConfig) return;

      const typeEl = document.createElement('div');
      typeEl.className = 'eom-child-type';

      const inner = document.createElement('div');
      inner.className = 'eom-child-type-inner';

      const placeholder = document.createElement('div');
      placeholder.className = 'eom-child-placeholder';

      const label = document.createElement('span');
      label.className = 'eom-child-type-label';
      label.textContent = childConfig.label;

      inner.appendChild(placeholder);
      inner.appendChild(label);
      typeEl.appendChild(inner);
      typeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this._onChildSelect(childId);
      });
      typesEl.appendChild(typeEl);
    });

    card.appendChild(typesEl);

    this._childSelectingEl = card;
    this.el.appendChild(card);
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

  // ── Card builder (reusable for parent and child items) ───

  _buildItemCard(item) {
    const config = FURNITURE[item.type];
    const card = document.createElement('div');
    card.className = 'eom-card';

    // Check if child is ghosted (blocked by collision/OOB)
    const isHiddenChild = item.parentId != null && item.ghosted;

    // Title bar with overflow menu
    const title = document.createElement('div');
    title.className = 'eom-card-title';
    if (isHiddenChild) title.classList.add('eom-card-title-disabled');

    const titleText = document.createElement('span');
    titleText.textContent = config.label;
    title.appendChild(titleText);

    const moreWrap = document.createElement('div');
    moreWrap.className = 'eom-more-wrap';

    const moreBtn = document.createElement('span');
    moreBtn.className = 'eom-more';
    moreBtn.textContent = '···';

    const dropdown = document.createElement('div');
    dropdown.className = 'eom-dropdown';
    dropdown.style.display = 'none';

    const deleteOpt = document.createElement('div');
    deleteOpt.className = 'eom-dropdown-item';
    deleteOpt.textContent = 'Delete';
    deleteOpt.addEventListener('click', (e) => {
      e.stopPropagation();
      this._onDeleteItem(item.id);
    });
    dropdown.appendChild(deleteOpt);

    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.style.display !== 'none';
      // Close any other open dropdowns
      this.el.querySelectorAll('.eom-dropdown').forEach(d => d.style.display = 'none');
      dropdown.style.display = isOpen ? 'none' : 'flex';
    });

    moreWrap.appendChild(moreBtn);
    moreWrap.appendChild(dropdown);
    title.appendChild(moreWrap);

    card.appendChild(title);

    // Options section (white bg)
    if (config.colorOptions && config.colorOptions.rows.length > 0) {
      const optionsEl = document.createElement('div');
      optionsEl.className = 'eom-card-options';

      config.colorOptions.rows.forEach((row, i) => {
        if (i > 0) {
          const divider = document.createElement('div');
          divider.className = 'eom-divider';
          optionsEl.appendChild(divider);
        }
        optionsEl.appendChild(this._buildOptionRow(row, item));
      });

      card.appendChild(optionsEl);
    }

    return card;
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
      labelEl.appendChild(valSpan);
    }

    rowEl.appendChild(labelEl);

    // Swatch grid
    const swatchGrid = document.createElement('div');
    swatchGrid.className = 'eom-swatch-grid';

    for (const opt of row.options) {
      const swatch = document.createElement('div');
      swatch.className = 'eom-swatch';
      if (opt.id === (item.colorId || row.options[0].id)) {
        swatch.classList.add('eom-swatch-active');
      }

      const circle = document.createElement('div');
      circle.className = 'eom-swatch-circle';
      circle.style.backgroundColor = '#' + opt.swatch.toString(16).padStart(6, '0');

      swatch.appendChild(circle);
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        this._onColorSelect(item.id, opt.id);
      });
      swatchGrid.appendChild(swatch);
    }

    rowEl.appendChild(swatchGrid);
    return rowEl;
  }

  // ── Actions ──────────────────────────────────────────────

  _onColorSelect(itemId, colorId) {
    const item = this.sceneData.get(itemId);
    if (!item) return;

    this.sceneData.update(itemId, { colorId });

    // Rebuild mesh with new color
    this.sceneCtrl._removeMesh(item);
    this.sceneCtrl._addMesh(item);

    // Re-select to restore halo
    if (item.parentId == null) {
      this.sceneCtrl.selectItem(itemId);
    }

    // Refresh menu
    this.show(this._itemId);
  }

  _onDeleteItem(itemId) {
    const item = this.sceneData.get(itemId);
    if (!item) return;

    if (item.parentId == null) {
      // Deleting parent — go to default
      this.sceneData.remove(itemId);
      this.state.set(STATES.DEFAULT);
    } else {
      // Deleting child — stay selected on parent
      const parentId = item.parentId;
      this.sceneData.remove(itemId);
      this.show(parentId);
    }
  }

  _onChildSelect(childTypeId) {
    const parentItem = this.sceneData.get(this._childParentId);
    if (!parentItem) return;

    const parentConfig = FURNITURE[parentItem.type];
    const groupConfig = parentConfig.slotGroups.find(s => s.id === this._childGroupId);

    // Adjust parent position so the child fits
    if (groupConfig) {
      this._adjustParentForChild(parentItem, childTypeId, groupConfig, this._childSubSlot);
    }

    this.sceneData.add({
      type:        childTypeId,
      x:           0,
      z:           0,
      rotation:    0,
      parentId:    this._childParentId,
      slotGroupId: this._childGroupId,
      subSlot:     this._childSubSlot,
    });

    // Back to selected — menu rebuilds with child card
    this.state.set(STATES.SELECTED, { itemId: this._childParentId });
  }

  /**
   * If placing this child would be blocked, shift the parent along the
   * slot's slide axis until the child clears.
   */
  _adjustParentForChild(parentItem, childType, groupConfig, subSlot) {
    const rot = parentItem.rotation || 0;
    const cosR = Math.abs(Math.cos(rot));
    const sinR = Math.abs(Math.sin(rot));

    const childFp = FURNITURE[childType].footprint;
    const halfW = (childFp.w * cosR + childFp.d * sinR) / 2;
    const halfD = (childFp.w * sinR + childFp.d * cosR) / 2;

    const childPos = getSlotGroupWorldPosition(parentItem, groupConfig, childType, null, subSlot);
    if (!isSlotBlocked(childPos, halfW, halfD, parentItem.id, this.room, this.sceneData)) return;

    const originItem = { ...parentItem, x: 0, z: 0 };
    const groupAtOrigin = getSlotGroupWorldPosition(originItem, groupConfig, childType, null, subSlot);
    const isHorizontal = Math.abs(groupAtOrigin.x) > Math.abs(groupAtOrigin.z);

    const childSlidePos = isHorizontal ? childPos.x : childPos.z;
    const roomMax = isHorizontal ? this.room.width : this.room.height;
    const dir = childSlidePos < roomMax / 2 ? 1 : -1;

    const step = 0.1;
    for (let s = step; s < roomMax; s += step) {
      const testParent = { ...parentItem };
      if (isHorizontal) testParent.x = parentItem.x + dir * s;
      else testParent.z = parentItem.z + dir * s;

      const testPos = getSlotGroupWorldPosition(testParent, groupConfig, childType, null, subSlot);
      if (!isSlotBlocked(testPos, halfW, halfD, parentItem.id, this.room, this.sceneData)) {
        this.sceneData.update(parentItem.id,
          isHorizontal ? { x: testParent.x } : { z: testParent.z }
        );
        return;
      }
    }
  }
}
