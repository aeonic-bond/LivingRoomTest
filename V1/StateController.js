/**
 * StateController
 *
 * Owns the application state and broadcasts transitions.
 * Other controllers register listeners to react to state changes.
 *
 * Usage:
 *   const state = new StateController();
 *   state.on('enter:select', (data) => { ... });
 *   state.on('exit:default', () => { ... });
 *   state.set('placing', { x: 5, z: 8 });
 */

// ── State definitions ────────────────────────────────────────
const STATES = {
  DEFAULT:       'default',
  PLACING:       'placing',
  SELECTED:      'selected',
  TRANSFORM:     'transform',
  PLACING_CHILD: 'placing_child',
};

class StateController {
  constructor() {
    this.current   = STATES.DEFAULT;
    this.data      = null;           // optional payload for the active state
    this._listeners = {};
  }

  /**
   * Register a listener.
   * @param {string} event - e.g. 'enter:select', 'exit:default', 'change'
   * @param {Function} fn
   */
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }

  /**
   * Remove a listener.
   */
  off(event, fn) {
    const list = this._listeners[event];
    if (!list) return;
    this._listeners[event] = list.filter(f => f !== fn);
  }

  /**
   * Transition to a new state.
   * @param {string} newState - one of STATES values
   * @param {*} [data] - optional payload (e.g. click position for select)
   */
  set(newState, data = null) {
    if (newState === this.current) return;

    const prev = this.current;
    this._emit('exit:' + prev);

    this.current = newState;
    this.data = data;

    this._emit('enter:' + newState, data);
    this._emit('change', { from: prev, to: newState, data });
  }

  /**
   * Check if currently in a given state.
   */
  is(state) {
    return this.current === state;
  }

  _emit(event, payload) {
    const list = this._listeners[event];
    if (!list) return;
    list.forEach(fn => fn(payload));
  }
}
