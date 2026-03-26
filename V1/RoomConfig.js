/**
 * RoomConfig
 *
 * Defines room geometry. Each room is a rectangle of panels.
 * Perimeter is clockwise corner points for EdgeAffinity to consume.
 */
const ROOMS = {
  rectangleDefault: {
    label: 'Rectangle Room: 12ft x 16ft',
    panelCols: 3,
    panelRows: 4,
    unitsPerPanel: 4,
    get width()  { return this.panelCols * this.unitsPerPanel; },
    get height() { return this.panelRows * this.unitsPerPanel; },
    get perimeter() {
      return [
        { x: 0, z: 0 },
        { x: this.width, z: 0 },
        { x: this.width, z: this.height },
        { x: 0, z: this.height },
      ];
    },
  },
  squareDefault: {
    label: 'Square Room: 16ft x 16ft',
    panelCols: 4,
    panelRows: 4,
    unitsPerPanel: 4,
    get width()  { return this.panelCols * this.unitsPerPanel; },
    get height() { return this.panelRows * this.unitsPerPanel; },
    get perimeter() {
      return [
        { x: 0, z: 0 },
        { x: this.width, z: 0 },
        { x: this.width, z: this.height },
        { x: 0, z: this.height },
      ];
    },
  },
};
