/**
 * FurnitureConfig
 *
 * Static registry of furniture types and their properties.
 * All sizes in grid units (1 unit = 1ft).
 *
 * footprint: { w, d } — abstract grid shape for placement, collision, pulse preview (w = width, d = depth)
 * mesh:      { type, w, h, d } — 3D rendering definition (w = width, h = height, d = depth; box primitives for now, GLTF later)
 */
// ── Color palettes ────────────────────────────────────────
// Shared palette definitions. Each option has:
//   swatch: hex shown in the picker circle
//   seat/back/arm: material colors for multi-part meshes (couch, sectional)
//   color: single material color for simple meshes (chair, table, etc.)

const PALETTE_UPHOLSTERED = [
  { id: 'stone',     label: 'Stone',     swatch: 0xC8C0B4, seat: 0xC8C0B4, back: 0xB0A898, arm: 0xBCB4A8 },
  { id: 'parchment', label: 'Parchment', swatch: 0xE8E0D4, seat: 0xE8E0D4, back: 0xD4CCC0, arm: 0xDDD5C9 },
  { id: 'fog',       label: 'Fog',       swatch: 0xB8B8B8, seat: 0xB8B8B8, back: 0xA0A0A0, arm: 0xACACAC },
  { id: 'charcoal',  label: 'Charcoal',  swatch: 0x555555, seat: 0x555555, back: 0x444444, arm: 0x4A4A4A },
  { id: 'navy',      label: 'Navy',      swatch: 0x2B4B7E, seat: 0x2B4B7E, back: 0x1E3A6B, arm: 0x243F6E },
  { id: 'sage',      label: 'Sage',      swatch: 0x8A9A7B, seat: 0x8A9A7B, back: 0x748A65, arm: 0x7F9270 },
  { id: 'mustard',   label: 'Mustard',   swatch: 0xC8A84E, seat: 0xC8A84E, back: 0xB0923C, arm: 0xBC9E45 },
];

const PALETTE_WOOD = [
  { id: 'light-wood',  label: 'Light Wood',  swatch: 0xC4A87A, color: 0xC4A87A },
  { id: 'walnut',      label: 'Walnut',      swatch: 0x6B4226, color: 0x6B4226 },
  { id: 'black-wood',  label: 'Black',       swatch: 0x2A2A2A, color: 0x2A2A2A },
  { id: 'white-wood',  label: 'White',       swatch: 0xE8E4DC, color: 0xE8E4DC },
];

const FURNITURE = {
  couch: {
    id: 'couch',
    label: 'Couch',
    affinity: 'edge',
    buffer: 1,
    footprint: { w: 7, d: 3 },
    mesh: { type: 'couch' },
    slotGroups: [
      { id: 'left',  side: 'left' },
      { id: 'right', side: 'right' },
    ],
    allowedChildren: ['sideTable', 'floorLamp'],
    colorOptions: { rows: [{ id: 'fabric', label: 'Fabric', options: PALETTE_UPHOLSTERED }] },
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
    slotGroups: [
      { id: 'left',  side: 'left' },
      { id: 'right', side: 'right' },
    ],
    allowedChildren: ['sideTable', 'floorLamp'],
    colorOptions: { rows: [{ id: 'fabric', label: 'Fabric', options: PALETTE_UPHOLSTERED }] },
  },
  chair: {
    id: 'chair',
    label: 'Chair',
    affinity: 'none',
    buffer: 1,
    footprint: { w: 3, d: 3 },
    mesh: { type: 'box', w: 3, h: 0.4, d: 3 },
    colorOptions: { rows: [{ id: 'fabric', label: 'Fabric', options: PALETTE_UPHOLSTERED }] },
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
    colorOptions: { rows: [{ id: 'wood', label: 'Wood', options: PALETTE_WOOD }] },
  },
  mediaConsole: {
    id: 'mediaConsole',
    label: 'Media Console',
    affinity: 'edge',
    buffer: 1,
    footprint: { w: 5, d: 2 },
    mesh: { type: 'box', w: 5, h: 0.3, d: 2 },
    colorOptions: { rows: [{ id: 'wood', label: 'Wood', options: PALETTE_WOOD }] },
  },

  // ── Child-only types ──────────────────────────────────────
  sideTable: {
    id: 'sideTable',
    label: 'Side Table',
    affinity: 'none',
    childOnly: true,
    buffer: 0,
    footprint: { w: 1.5, d: 1.5 },
    mesh: { type: 'roundedBox', w: 1.5, h: 1.2, d: 1.5, r: 0.15 },
    colorOptions: { rows: [{ id: 'wood', label: 'Wood', options: PALETTE_WOOD }] },
  },
  floorLamp: {
    id: 'floorLamp',
    label: 'Floor Lamp',
    affinity: 'none',
    childOnly: true,
    buffer: 0,
    footprint: { w: 1, d: 1 },
    mesh: { type: 'cylinder', radius: 0.5, h: 2.5 },
    colorOptions: { rows: [{ id: 'metal', label: 'Metal', options: [
      { id: 'brass',  label: 'Brass',  swatch: 0xB5A642, color: 0xB5A642 },
      { id: 'black',  label: 'Black',  swatch: 0x2A2A2A, color: 0x2A2A2A },
      { id: 'gold',   label: 'Gold',   swatch: 0xD4AF37, color: 0xD4AF37 },
    ]}] },
  },
};

/** Ordered list for menu display. */
const FURNITURE_ORDER = [
  'couch',
  'sectional',
  'chair',
  'coffeeTable',
  'mediaConsole',
];
