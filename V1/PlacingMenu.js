/**
 * PlacingMenu
 *
 * Context menu for choosing a furniture type to place.
 * Listens to StateController for enter:placing / exit:placing.
 */

const FURNITURE_TYPES = [
  { id: 'couch',        label: 'Couch' },
  { id: 'sectional',    label: 'Sectional' },
  { id: 'chair',        label: 'Chair' },
  { id: 'chairPair',    label: 'Pair of Chairs' },
  { id: 'coffeeTable',  label: 'Coffee Table' },
  { id: 'mediaConsole', label: 'Media Console' },
];

class PlacingMenu {
  /**
   * @param {HTMLElement} container - the scene container to append the menu into
   * @param {StateController} state
   * @param {THREE.OrthographicCamera} camera
   * @param {HTMLCanvasElement} canvas
   */
  constructor(container, state, camera, canvas) {
    this.container = container;
    this.state     = state;
    this.camera    = camera;
    this.canvas    = canvas;

    this._buildDOM();
    this._bindState();
  }

  _buildDOM() {
    this.el = document.createElement('div');
    this.el.className = 'placing-menu';
    this.el.style.display = 'none';

    FURNITURE_TYPES.forEach(type => {
      const row = document.createElement('div');
      row.className = 'placing-menu-item';

      const icon = document.createElement('div');
      icon.className = 'placing-menu-icon';

      const label = document.createElement('span');
      label.className = 'placing-menu-label';
      label.textContent = type.label;

      row.appendChild(icon);
      row.appendChild(label);

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
    this.el.style.display = 'flex';

    const screen = this._worldToScreen(data.x, data.z);
    const offset = 4;  // --spacer-200
    const pad    = 8;  // min distance from container edge

    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const mw = this.el.offsetWidth;
    const mh = this.el.offsetHeight;

    // Default: right and below click point
    let left = screen.x + offset;
    let top  = screen.y + offset;

    // Flip horizontal if overflows right
    if (left + mw > cw - pad) {
      left = screen.x - mw - offset;
    }

    // Flip vertical if overflows bottom
    if (top + mh > ch - pad) {
      top = screen.y - mh - offset;
    }

    // Clamp to stay on screen
    left = Math.max(pad, Math.min(cw - mw - pad, left));
    top  = Math.max(pad, Math.min(ch - mh - pad, top));

    this.el.style.left = left + 'px';
    this.el.style.top  = top + 'px';
  }

  hide() {
    this.el.style.display = 'none';
  }

  _onSelect(typeId) {
    const data = this.state.data;
    // TODO: hand off to furniture placement system
    console.log('Place:', typeId, 'at', data);
    this.state.set(STATES.DEFAULT);
  }
}
