/**
 * FurnitureConfig
 *
 * Static registry of furniture types and their properties.
 * All sizes in grid units (1 unit = 1ft).
 *
 * footprint: { w, d } — abstract grid shape for placement, collision, pulse preview (w = width, d = depth)
 * mesh:      { type, w, h, d } — 3D rendering definition (w = width, h = height, d = depth; box primitives for now, GLTF later)
 */
const FURNITURE = {
  couch: {
    id: 'couch',
    label: 'Couch',
    affinity: 'edge',
    buffer: 1,
    footprint: { w: 7, d: 3 },
    mesh: { type: 'couch' },
    slots: [
      { id: 'left-0',  side: 'left',  along: 0.5 },
      { id: 'right-0', side: 'right', along: 0.5 },
    ],
    allowedChildren: ['sideTable', 'floorLamp'],
  },
  sectional: {
    id: 'sectional',
    label: 'Sectional',
    affinity: 'corner',
    buffer: 1,
    footprint: {
      type: 'L',
      hinge: { w: 3, d: 3 },       // corner block where arms meet
      majorThrust: 6,               // extends beyond hinge along major edge
      minorThrust: 4,               // extends beyond hinge along minor edge
    },
    mesh: { type: 'sectional' },
    slots: [
      { id: 'left-0',  side: 'left',  along: 0.5 },
      { id: 'right-0', side: 'right', along: 0.5 },
    ],
    allowedChildren: ['sideTable', 'floorLamp'],
  },
  chair: {
    id: 'chair',
    label: 'Chair',
    affinity: 'none',
    buffer: 1,
    footprint: { w: 3, d: 3 },
    mesh: { type: 'box', w: 3, h: 0.4, d: 3 },
  },
  chairPair: {
    id: 'chairPair',
    label: 'Pair of Chairs',
    affinity: 'edge',
    buffer: 1,
    footprint: { w: 7, d: 3 },
    mesh: { type: 'box', w: 7, h: 0.4, d: 3 },
  },
  coffeeTable: {
    id: 'coffeeTable',
    label: 'Coffee Table',
    affinity: 'none',
    buffer: 1,
    footprint: { w: 4, d: 2 },
    mesh: { type: 'box', w: 4, h: 0.2, d: 2 },
  },
  mediaConsole: {
    id: 'mediaConsole',
    label: 'Media Console',
    affinity: 'edge',
    buffer: 1,
    footprint: { w: 5, d: 2 },
    mesh: { type: 'box', w: 5, h: 0.3, d: 2 },
  },

  // ── Child-only types ──────────────────────────────────────
  sideTable: {
    id: 'sideTable',
    label: 'Side Table',
    affinity: 'none',
    childOnly: true,
    buffer: 0,
    footprint: { w: 1.5, d: 1.5 },
    mesh: { type: 'box', w: 1.5, h: 1.2, d: 1.5 },
  },
  floorLamp: {
    id: 'floorLamp',
    label: 'Floor Lamp',
    affinity: 'none',
    childOnly: true,
    buffer: 0,
    footprint: { w: 1, d: 1 },
    mesh: { type: 'cylinder', radius: 0.5, h: 2.5 },
  },
};

/** Ordered list for menu display. */
const FURNITURE_ORDER = [
  'couch',
  'sectional',
  'chair',
  'chairPair',
  'coffeeTable',
  'mediaConsole',
];
