/**
 * SlotUtils
 *
 * Computes world positions for child slots on parent furniture.
 * Slot positions are derived from parent transform + footprint + slot config.
 * Gap between parent edge and child center = parentHalf + childHalf + SLOT_GAP.
 *
 * Supports rect and L-shape footprints.
 */

const SLOT_GAP = 0.25; // ft edge-to-edge spacing

/**
 * Compute the world position of a slot on a parent item.
 * @param {Object} parentItem - SceneData item (x, z, rotation, sx, sz)
 * @param {Object} slotConfig - from FurnitureConfig slots array ({ id, side, along })
 * @param {string} [childType] - child furniture type id (for size-aware offset), or null for slot indicator
 * @param {number} [indicatorSize] - when childType is null, use this as the indicator square size
 * @returns {{ x: number, z: number }}
 */
function getSlotWorldPosition(parentItem, slotConfig, childType, indicatorSize, subSlot) {
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

  const local = fp.type === 'L'
    ? _lShapeSlotLocal(fp, slotConfig, childFp)
    : _rectSlotLocal(fp, slotConfig, childFp);

  // Apply scale mirroring (L-shapes use sx/sz for corner orientation)
  local.x *= (parentItem.sx || 1);
  local.z *= (parentItem.sz || 1);

  // Rotate local offset by parent rotation (matches THREE.js rotation.y)
  const rot = parentItem.rotation || 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  let rx = local.x * cos + local.z * sin;
  let rz = -local.x * sin + local.z * cos;

  // Apply sub-slot offset in world space along the edge normal direction.
  // Normal = (sin(rot), cos(rot)). Back = toward wall = opposite of normal.
  if (subSlot) {
    const side = slotConfig.side;
    let sideDepth;
    if (fp.type === 'L') {
      sideDepth = (side === 'left' || side === 'right') ? fp.hinge.d : fp.hinge.w;
    } else {
      sideDepth = (side === 'left' || side === 'right') ? fp.d : fp.w;
    }
    const offset = sideDepth / 4;
    // back = -normal (toward wall), front = +normal (into room)
    const sign = (subSlot === 'back') ? -1 : 1;
    rx += sign * Math.sin(rot) * offset;
    rz += sign * Math.cos(rot) * offset;
  }

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
 * Compute local offset for a slot on an L-shape footprint.
 * Slots on left/right are relative to the major arm.
 * Hinge center is at origin.
 */
function _lShapeSlotLocal(fp, slot, childFp) {
  const h = fp.hinge;
  const majorW = h.w + fp.majorThrust;
  const offX = -h.w / 2;

  // along: 0.5 = centered along major arm depth (h.d)
  const alongZ = (slot.along - 0.5) * h.d;

  switch (slot.side) {
    case 'left':
      return {
        x: offX - SLOT_GAP - childFp.w / 2,
        z: alongZ,
      };
    case 'right':
      return {
        x: offX + majorW + SLOT_GAP + childFp.w / 2,
        z: alongZ,
      };
    default:
      return { x: 0, z: 0 };
  }
}

/**
 * Check if a position with given AABB half-extents is blocked.
 * Blocked = out of room bounds OR overlapping a non-child placed item.
 * Used by SlotController, SceneController (children), and PlacingChildMenu.
 *
 * @param {{ x: number, z: number }} pos - world position
 * @param {number} halfW - AABB half-width
 * @param {number} halfD - AABB half-depth
 * @param {number} parentId - parent item id to skip in collision
 * @param {Object} room - room config with width, height
 * @param {SceneData} sceneData
 * @returns {boolean}
 */
function isSlotBlocked(pos, halfW, halfD, parentId, room, sceneData) {
  // Room bounds
  if (pos.x - halfW < 0 || pos.x + halfW > room.width ||
      pos.z - halfD < 0 || pos.z + halfD > room.height) return true;

  // Collision with placed items (skip children, skip parent)
  const rect = {
    minX: pos.x - halfW, minZ: pos.z - halfD,
    maxX: pos.x + halfW, maxZ: pos.z + halfD,
  };
  for (const other of sceneData.items) {
    if (other.id === parentId) continue;
    if (other.parentId != null) continue;
    const otherRects = Collision.getWorldRects(other.type, other.x, other.z, other);
    for (const r of otherRects) {
      if (Collision.rectsOverlap(rect, r)) return true;
    }
  }
  return false;
}

/**
 * Get all slot world positions for a parent item.
 * @param {Object} parentItem - SceneData item
 * @returns {Array<{ slotId: string, x: number, z: number }>}
 */
function getAllSlotPositions(parentItem) {
  const config = FURNITURE[parentItem.type];
  if (!config || !config.slotGroups) return [];

  return config.slotGroups.map(sg => {
    const pos = getSlotWorldPosition(parentItem, sg, null);
    return { slotGroupId: sg.id, x: pos.x, z: pos.z };
  });
}
