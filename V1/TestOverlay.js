/**
 * TestOverlay
 *
 * Toggle with 'O' key. Transparent overlay for placing
 * exploratory UI elements on screen.
 */
class TestOverlay {
  constructor(container, opts = {}) {
    this.container = container;
    this.visible = false;

    this.el = document.createElement('div');
    this.el.className = 'test-overlay';
    this.el.style.display = 'none';
    this.container.appendChild(this.el);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'o' || e.key === 'O') this.toggle();
    });
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    if (this.visible && !this._built) {
      this._build();
      this._built = true;
    }
  }

  _build() {
    this._materials = [
      {
        name: 'Capelo Linen-Cotton',
        colorLabel: 'Grey Fog',
        swatches: [
          { color: '#0a5b70' },
          { color: '#f1d45d' },
          { color: '#bdbec1', active: true },
          { color: '#d88c69' },
          { color: '#d8e0f8' },
          { color: '#426396' },
          { color: '#ffffff', border: true },
        ],
      },
      {
        name: 'Boucle',
        swatches: [
          { color: '#0a5b70' },
          { color: '#f1d45d' },
          { color: '#bdbec1' },
          { color: '#d88c69' },
          { color: '#d8e0f8' },
          { color: '#426396' },
          { color: '#ffffff', border: true },
        ],
      },
      {
        name: 'Velvet',
        swatches: [
          { color: '#f1d45d' },
          { color: '#d88c69' },
          { color: '#d8e0f8' },
          { color: '#426396' },
        ],
      },
      {
        name: 'Brushed Cotton',
        swatches: [
          { color: '#f1d45d' },
          { color: '#d88c69' },
          { color: '#d8e0f8' },
          { color: '#426396' },
        ],
      },
    ];

    this._expanded = false;
    this._cardWrapper = this._addElement('', { top: '40px', left: '40px' });
    this._renderCard();
  }

  _renderCard() {
    this._cardWrapper.innerHTML = '';
    if (this._expanded) {
      this._cardWrapper.appendChild(this._buildFullCard('Misora 3 Seat', this._materials));
    } else {
      this._cardWrapper.appendChild(this._buildPreviewCard('Misora 3 Seat', this._materials[0]));
    }
  }

  _toggleExpand() {
    this._expanded = !this._expanded;
    this._renderCard();
  }

  // ── Preview card ──────────────────────────────────────

  _buildPreviewCard(productName, material) {
    const outer = document.createElement('div');
    outer.className = 'to-container v-default';
    outer.style.position = 'relative';

    const card = document.createElement('div');
    card.className = 'to-card';

    // Title row
    card.appendChild(this._buildTitleRow(productName));

    // White options section
    const options = document.createElement('div');
    options.className = 'to-options-section';

    // Material text block (stacked, no chevron)
    const textBlock = document.createElement('div');
    textBlock.className = 'to-material-text';
    textBlock.style.width = '134px';

    const matLabel = document.createElement('p');
    matLabel.className = 'to-material-label';
    matLabel.textContent = material.name;

    const colorLabel = document.createElement('p');
    colorLabel.className = 'to-color-label';
    colorLabel.textContent = material.colorLabel || '';

    textBlock.appendChild(matLabel);
    textBlock.appendChild(colorLabel);
    options.appendChild(textBlock);

    // Swatch grid (3 cols)
    options.appendChild(this._buildSwatchGrid(material.swatches, 132));

    card.appendChild(options);
    outer.appendChild(card);

    // Expand tab (bottom-right corner)
    const expandTab = document.createElement('div');
    expandTab.className = 'to-expand-tab';
    const expandIcon = document.createElement('img');
    expandIcon.src = '../Icons/ChevronDown.svg';
    expandIcon.className = 'to-expand-icon';
    expandTab.appendChild(expandIcon);
    expandTab.addEventListener('click', () => this._toggleExpand());
    outer.appendChild(expandTab);

    return outer;
  }

  // ── Full card ─────────────────────────────────────────

  _buildFullCard(productName, materials) {
    const outer = document.createElement('div');
    outer.className = 'to-container v-default';
    outer.style.position = 'relative';

    const card = document.createElement('div');
    card.className = 'to-card';

    // Title row
    card.appendChild(this._buildTitleRow(productName));

    // White options section (fixed height, scrollable)
    const options = document.createElement('div');
    options.className = 'to-options-section to-options-full';

    const innerScroll = document.createElement('div');
    innerScroll.className = 'to-options-scroll';

    materials.forEach((mat, i) => {
      const section = document.createElement('div');
      section.className = 'to-material-section';

      // Header row: material name (left) + color label (right) for first, just name for rest
      const header = document.createElement('div');
      header.className = 'to-material-header';

      const nameEl = document.createElement('p');
      nameEl.className = 'to-material-label';
      nameEl.textContent = mat.name;
      header.appendChild(nameEl);

      if (mat.colorLabel) {
        const colorEl = document.createElement('p');
        colorEl.className = 'to-color-label';
        colorEl.textContent = mat.colorLabel;
        header.appendChild(colorEl);
      }

      section.appendChild(header);

      // Swatch grid (7 cols)
      section.appendChild(this._buildSwatchGrid(mat.swatches, 324));

      innerScroll.appendChild(section);
    });

    options.appendChild(innerScroll);
    card.appendChild(options);
    outer.appendChild(card);

    // Collapse tab (bottom-right corner, chevron up)
    const collapseTab = document.createElement('div');
    collapseTab.className = 'to-expand-tab';
    const collapseIcon = document.createElement('img');
    collapseIcon.src = '../Icons/ChevronDown.svg';
    collapseIcon.className = 'to-expand-icon to-expand-icon-up';
    collapseTab.appendChild(collapseIcon);
    collapseTab.addEventListener('click', () => this._toggleExpand());
    outer.appendChild(collapseTab);

    return outer;
  }

  // ── Shared builders ───────────────────────────────────

  _buildTitleRow(name) {
    const row = document.createElement('div');
    row.className = 'to-title-row';

    const text = document.createElement('span');
    text.className = 'to-title-text';
    text.textContent = name;

    const more = document.createElement('span');
    more.className = 'to-more';
    more.textContent = '···';

    row.appendChild(text);
    row.appendChild(more);
    return row;
  }

  _buildSwatchGrid(swatches, width) {
    const grid = document.createElement('div');
    grid.className = 'to-swatch-grid';
    grid.style.width = width + 'px';

    for (const s of swatches) {
      const swatch = document.createElement('div');
      swatch.className = 'to-swatch' + (s.active ? ' to-swatch-active' : '');

      const square = document.createElement('div');
      square.className = 'to-swatch-square';
      square.style.backgroundColor = s.color;
      if (s.border) square.classList.add('to-swatch-bordered');

      swatch.appendChild(square);
      grid.appendChild(swatch);
    }
    return grid;
  }

  _addElement(html, style) {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    Object.assign(wrapper.style, style);
    wrapper.innerHTML = html;
    this.el.appendChild(wrapper);
    return wrapper;
  }
}
