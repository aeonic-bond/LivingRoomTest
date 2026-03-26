/**
 * SceneData
 *
 * Single source of truth for placed furniture in the scene.
 * JSON-shaped runtime data store. Other controllers listen
 * for changes and render/update accordingly.
 *
 * Future: import/export for templates and session persistence.
 */
class SceneData {
  constructor() {
    this._nextId = 0;
    this.items = [];
    this._listeners = {};
  }

  /**
   * Add a furniture item to the scene.
   * @param {Object} entry
   * @param {string} entry.type     - furniture type id (e.g. 'couch')
   * @param {number} entry.x        - world x position
   * @param {number} entry.z        - world z position
   * @param {number} entry.rotation - rotation in radians
   * @param {number|null} entry.edgeId - assigned edge id, or null
   * @param {string|null} entry.variant - variant id, or null
   * @returns {Object} the created item (with generated id)
   */
  add(entry) {
    const item = {
      id: this._nextId++,
      type: entry.type,
      x: entry.x,
      z: entry.z,
      rotation: entry.rotation || 0,
      edgeId:      entry.edgeId !== undefined ? entry.edgeId : null,
      cornerId:    entry.cornerId !== undefined ? entry.cornerId : null,
      majorEdgeId: entry.majorEdgeId !== undefined ? entry.majorEdgeId : null,
      minorEdgeId: entry.minorEdgeId !== undefined ? entry.minorEdgeId : null,
      sx:          entry.sx !== undefined ? entry.sx : 1,
      sz:          entry.sz !== undefined ? entry.sz : 1,
      variant:     entry.variant || null,
    };
    this.items.push(item);
    this._emit('add', item);
    return item;
  }

  /**
   * Remove an item by id.
   */
  remove(id) {
    const idx = this.items.findIndex(it => it.id === id);
    if (idx === -1) return;
    const item = this.items[idx];
    this.items.splice(idx, 1);
    this._emit('remove', item);
  }

  /**
   * Get an item by id.
   */
  get(id) {
    return this.items.find(it => it.id === id) || null;
  }

  /**
   * Update properties on an existing item.
   */
  update(id, props) {
    const item = this.get(id);
    if (!item) return;
    Object.assign(item, props);
    this._emit('update', item);
  }

  /**
   * Export current state as a plain JSON-safe object.
   */
  export() {
    return {
      items: this.items.map(it => ({ ...it })),
    };
  }

  /**
   * Load scene data from a JSON object. Replaces current state.
   */
  load(json) {
    // Clear existing
    const old = [...this.items];
    this.items = [];
    old.forEach(it => this._emit('remove', it));

    // Load new
    if (json && json.items) {
      json.items.forEach(entry => {
        const item = {
          id: this._nextId++,
          type: entry.type,
          x: entry.x,
          z: entry.z,
          rotation: entry.rotation || 0,
          edgeId: entry.edgeId !== undefined ? entry.edgeId : null,
          variant: entry.variant || null,
        };
        this.items.push(item);
        this._emit('add', item);
      });
    }
  }

  /**
   * Register a listener.
   * @param {string} event - 'add', 'remove', 'update'
   * @param {Function} fn - called with the item
   */
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }

  _emit(event, data) {
    const list = this._listeners[event];
    if (!list) return;
    list.forEach(fn => fn(data));
  }
}
