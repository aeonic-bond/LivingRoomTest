class PrimaryCard {
  /**
   * @param {HTMLElement} mountEl - The element to append the card into.
   */
  constructor(mountEl) {
    this.el = document.createElement('div');
    this.el.className = 'primary-card';
    this._buildDOM();
    mountEl.appendChild(this.el);

    /** Optional callback: onSelect(optionLabel, swatch) */
    this.onSelect = null;
  }

  _buildDOM() {
    // ── ID section ───────────────────────────────────────────────
    this._header = document.createElement('div');
    this._header.className = 'pc-header';

    // Left: back chevron (non-functional) + name
    const nameGroup = document.createElement('div');
    nameGroup.className = 'pc-header-name';

    const backIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    backIcon.setAttribute('viewBox', '0 0 10 16');
    backIcon.setAttribute('fill', 'none');
    backIcon.setAttribute('stroke', 'currentColor');
    backIcon.setAttribute('stroke-width', '2.5');
    backIcon.setAttribute('stroke-linecap', 'round');
    backIcon.classList.add('pc-header-name-icon');
    const backPath = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    backPath.setAttribute('points', '8,2 2,8 8,14');
    backIcon.appendChild(backPath);

    this._nameLabel = document.createElement('span');
    this._nameLabel.className = 'pc-header-name-label';

    nameGroup.appendChild(backIcon);
    nameGroup.appendChild(this._nameLabel);

    // Right: variant label + dropdown chevron (non-functional)
    const variantGroup = document.createElement('div');
    variantGroup.className = 'pc-header-variant';

    this._variantLabel = document.createElement('span');
    this._variantLabel.className = 'pc-header-variant-label';

    const dropIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    dropIcon.setAttribute('viewBox', '0 0 10 6');
    dropIcon.setAttribute('fill', 'none');
    dropIcon.setAttribute('stroke', 'currentColor');
    dropIcon.setAttribute('stroke-width', '2');
    dropIcon.setAttribute('stroke-linecap', 'round');
    dropIcon.classList.add('pc-header-variant-icon');
    const dropPath = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    dropPath.setAttribute('points', '1,1 5,5 9,1');
    dropIcon.appendChild(dropPath);

    variantGroup.appendChild(this._variantLabel);
    variantGroup.appendChild(dropIcon);

    this._header.appendChild(nameGroup);
    this._header.appendChild(variantGroup);
    this.el.appendChild(this._header);

    // ── Option section ───────────────────────────────────────────
    this._body = document.createElement('div');
    this._body.className = 'pc-body';
    this.el.appendChild(this._body);
  }

  /**
   * Populate and show the card.
   * @param {Object} config
   * @param {string} config.name    - Product name shown in the header.
   * @param {string} config.variant - Variant label shown in the header.
   * @param {Array}  config.options - [{ label, value, swatches: [{ name, hex, active, onSelect }] }]
   */
  show({ name = '', variant = '', options }) {
    this._nameLabel.textContent = name;
    this._variantLabel.textContent = variant;
    this._body.innerHTML = '';

    options.forEach((option, i) => {
      if (i > 0) {
        const divider = document.createElement('div');
        divider.className = 'pc-divider';
        this._body.appendChild(divider);
      }
      this._body.appendChild(this._buildOptionRow(option));
    });

    this.el.classList.add('visible');
  }

  hide() {
    this.el.classList.remove('visible');
  }

  _isLightColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 200;
  }

  _buildOptionRow(option) {
    const row = document.createElement('div');
    row.className = 'pc-option-row';

    // Type row: label left, current value right
    const type = document.createElement('div');
    type.className = 'pc-option-type';

    const labelEl = document.createElement('span');
    labelEl.textContent = option.label;

    const valueEl = document.createElement('span');
    valueEl.textContent = option.value;

    type.appendChild(labelEl);
    type.appendChild(valueEl);
    row.appendChild(type);

    // Swatches
    const swatchesEl = document.createElement('div');
    swatchesEl.className = 'pc-swatches';

    option.swatches.forEach(swatch => {
      const el = document.createElement('div');
      const isLight = this._isLightColor(swatch.hex);
      el.className = 'pc-swatch' + (swatch.active ? ' active' + (isLight ? ' light' : '') : '');
      el.style.background = swatch.hex;
      el.title = swatch.name;

      el.addEventListener('click', e => {
        e.stopPropagation();
        swatchesEl.querySelectorAll('.pc-swatch').forEach(s => s.classList.remove('active', 'light'));
        el.classList.add('active');
        if (isLight) el.classList.add('light');
        valueEl.textContent = swatch.name;
        if (swatch.onSelect) swatch.onSelect();
        if (this.onSelect) this.onSelect(option.label, swatch);
      });

      swatchesEl.appendChild(el);
    });

    row.appendChild(swatchesEl);
    return row;
  }
}
