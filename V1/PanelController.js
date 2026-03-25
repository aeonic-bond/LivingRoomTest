/**
 * PanelController
 *
 * Owns the left-side panel width (base + future variant panel).
 * Manages drag-resize and notifies a callback when the total width changes.
 *
 * Usage:
 *   const panels = new PanelController({
 *     panel:   document.getElementById('dynamicLeftPanel'),
 *     handle:  document.getElementById('panelHandle'),
 *     onChange: (totalWidth) => { // resize camera, renderer }
 *   });
 */
class PanelController {
  /**
   * @param {Object} opts
   * @param {HTMLElement} opts.panel    - the left panel element
   * @param {HTMLElement} opts.handle   - the drag handle element
   * @param {Function}    opts.onChange - called with total left-side width (px) on resize
   * @param {number}     [opts.minWidth=60]
   * @param {number}     [opts.maxWidth=480]
   * @param {number}     [opts.initialWidth=184]
   */
  constructor({ panel, handle, onChange, minWidth = 60, maxWidth = 480, initialWidth = 184 }) {
    this.panel    = panel;
    this.handle   = handle;
    this.onChange  = onChange || (() => {});

    this.minWidth = minWidth;
    this.maxWidth = maxWidth;
    this.baseWidth = initialWidth;

    this.panel.style.width = this.baseWidth + 'px';

    this._initDrag();
  }

  /** Current total left-side width (base + future variant panel). */
  get totalWidth() {
    return this.baseWidth;
  }

  _initDrag() {
    let startX, startWidth;

    const onMove = (e) => {
      const dx = e.clientX - startX;
      const w = Math.max(this.minWidth, Math.min(this.maxWidth, startWidth + dx));
      this.baseWidth = w;
      this.panel.style.width = w + 'px';
      this.onChange(this.totalWidth);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    this.handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = this.baseWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}
