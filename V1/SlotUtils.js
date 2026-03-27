/**
 * SlotUtils
 *
 * Computes world positions for child slots on parent furniture.
 * Slot positions are derived from parent transform + footprint + slot config.
 * Gap between parent edge and child center = parentHalf + childHalf + SLOT_GAP.
 *
 * Currently supports rect footprints only (edge affinity parents).
 */

const SLOT_GAP = 0.25; // ft edge-to-edge spacing

/**
 * Compute the world position of a slot on a parent item.
 * @param {Object} parentItem - SceneData item (x, z, rotation)
 * @param {Object} slotConfig - from FurnitureConfig slots array ({ id, side, along })
 * @param {string} [childType] - child furniture type id (for size-aware offset), or null for slot indicator
 * @param {number} [indicatorSize] - when childType is null, use this as the indicator square size
 * @returns {{ x: number, z: number }}
 */
function getSlotWorldPosition(parentItem, slotConfig, childType, indicatorSize) {
  const parentConfig = FURNITURE[parentItem.type];
  const fp = parentConfig.footprint;
  let childFp;
  if (childType) {
    childFp = FURNITURE[childType].footprint;
  } else if (indicatorSize) {
    childFp = { w: indicatorSize, d: indicatorSize };
  } else {
    childFp = { w: 0, d: 0 };
  }

  const local = _rectSlotLocal(fp, slotConfig, childFp);

  // Rotate local offset by parent rotation
  const cos = Math.cos(parentItem.rotation || 0);
  const sin = Math.sin(parentItem.rotation || 0);
  const rx = local.x * cos - local.z * sin;
  const rz = local.x * sin + local.z * cos;

  return {
    x: parentItem.x + rx,
    z: parentItem.z + rz,
  };
}

/**
 * Compute local offset for a slot on a rect footprint.
 * Parent center is at origin. Side determines which edge.
 */
function _rectSlotLocal(fp, slot, childFp) {
  const halfW = fp.w / 2;
  const halfD = fp.d / 2;
  // along: 0 = front of side, 1 = back; 0.5 = centered along depth
  const alongZ = (slot.along - 0.5) * fp.d;

  switch (slot.side) {
    case 'left':
      return {
        x: -halfW - SLOT_GAP - childFp.w / 2,
        z: alongZ,
      };
    case 'right':
      return {
        x: halfW + SLOT_GAP + childFp.w / 2,
        z: alongZ,
      };
    case 'front':
      return {
        x: (slot.along - 0.5) * fp.w,
        z: -halfD - SLOT_GAP - childFp.d / 2,
      };
    case 'back':
      return {
        x: (slot.along - 0.5) * fp.w,
        z: halfD + SLOT_GAP + childFp.d / 2,
      };
    default:
      return { x: 0, z: 0 };
  }
}

/**
 * Get all slot world positions for a parent item.
 * @param {Object} parentItem - SceneData item
 * @returns {Array<{ slotId: string, x: number, z: number }>}
 */
function getAllSlotPositions(parentItem) {
  const config = FURNITURE[parentItem.type];
  if (!config || !config.slots) return [];

  return config.slots.map(slot => {
    const pos = getSlotWorldPosition(parentItem, slot, null);
    return { slotId: slot.id, x: pos.x, z: pos.z };
  });
}
