/**
 * SlotUtils
 *
 * Computes world positions for slot groups on parent furniture.
 * A slot group represents one side of a parent that can accept children.
 * Width is derived dynamically from the largest allowed child footprint.
 * Depth matches the parent's depth on that side.
 *
 * Supports rect and L-shape footprints.
 */

const SLOT_GAP = 0.25; // ft edge-to-edge spacing

/**
 * Get the max child width from a parent's allowedChildren list.
 * Used to size slot group indicators.
 * @param {Object} parentConfig - FURNITURE config entry
 * @returns {number}
 */
function getMaxChildWidth(parentConfig) {
  if (!parentConfig.allowedChildren) return 1;
  let maxW = 0;
  for (const childTypeId of parentConfig.allowedChildren) {
    const childConfig = FURNITURE[childTypeId];
    if (childConfig && childConfig.footprint) {
      maxW = Math.max(maxW, childConfig.footprint.w, childConfig.footprint.d);
    }
  }
  return maxW || 1;
}

/**
 * Get the max child depth from a parent's allowedChildren list.
 * Used to size the active sub-slot on hover.
 * @param {Object} parentConfig - FURNITURE config entry
 * @returns {number}
 */
function getMaxChildDepth(parentConfig) {
  if (!parentConfig.allowedChildren) return 1;
  let maxD = 0;
  for (const childTypeId of parentConfig.allowedChildren) {
    const childConfig = FURNITURE[childTypeId];
    if (childConfig && childConfig.footprint) {
      maxD = Math.max(maxD, childConfig.footprint.d);
    }
  }
  return maxD || 1;
}

/**
 * Compute the world position of a slot group on a parent item.
 * The slot group sits centered along the parent's side edge.
 * When subSlot is specified, offsets to the front or back sub-slot center.
 *
 * @param {Object} parentItem - SceneData item (x, z, rotation, sx, sz)
 * @param {Object} groupConfig - from FurnitureConfig slotGroups array ({ id, side })
 * @param {string} [childType] - child furniture type id (for size-aware offset), or null for indicator
 * @param {number} [indicatorWidth] - when childType is null, use this as the indicator width
 * @param {string} [subSlot] - 'front' or 'back' to offset to sub-slot center
 * @returns {{ x: number, z: number }}
 */
function getSlotGroupWorldPosition(parentItem, groupConfig, childType, indicatorWidth, subSlot) {
  const parentConfig = FURNITURE[parentItem.type];
  const fp = parentConfig.footprint;

  let childW;
  if (childType) {
    childW = FURNITURE[childType].footprint.w;
  } else if (indicatorWidth) {
    childW = indicatorWidth;
  } else {
    childW = getMaxChildWidth(parentConfig);
  }

  const local = fp.type === 'L'
    ? _lShapeGroupLocal(fp, groupConfig, childW)
    : _rectGroupLocal(fp, groupConfig, childW);

  // Apply sub-slot offset along the depth axis
  if (subSlot) {
    const parentDepth = getSlotGroupDepth(parentConfig, groupConfig.side);
    const childD = getMaxChildDepth(parentConfig);
    // Offset from group center to sub-slot center
    const offset = (parentDepth / 2) - (childD / 2);
    // Depth axis: left/right = Z, front/back = X
    if (groupConfig.side === 'left' || groupConfig.side === 'right') {
      local.z += subSlot === 'back' ? offset : -offset;
    } else {
      local.x += subSlot === 'back' ? offset : -offset;
    }
  }

  // Apply scale mirroring (L-shapes use sx/sz for corner orientation)
  local.x *= (parentItem.sx || 1);
  local.z *= (parentItem.sz || 1);

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
 * Get the depth of the parent along a given side.
 * This determines the slot group indicator's depth dimension.
 * @param {Object} parentConfig - FURNITURE config entry
 * @param {string} side - 'left', 'right', 'front', 'back'
 * @returns {number}
 */
function getSlotGroupDepth(parentConfig, side) {
  const fp = parentConfig.footprint;
  if (fp.type === 'L') {
    // For L-shapes, left/right sides run along hinge depth
    if (side === 'left' || side === 'right') return fp.hinge.d;
    return fp.hinge.w;
  }
  // Rect: left/right run along depth, front/back run along width
  if (side === 'left' || side === 'right') return fp.d;
  return fp.w;
}

/**
 * Compute local offset for a slot group on a rect footprint.
 * Centered along the side edge.
 */
function _rectGroupLocal(fp, group, childW) {
  const halfW = fp.w / 2;
  const halfD = fp.d / 2;

  switch (group.side) {
    case 'left':
      return { x: -halfW - SLOT_GAP - childW / 2, z: 0 };
    case 'right':
      return { x: halfW + SLOT_GAP + childW / 2, z: 0 };
    case 'front':
      return { x: 0, z: -halfD - SLOT_GAP - childW / 2 };
    case 'back':
      return { x: 0, z: halfD + SLOT_GAP + childW / 2 };
    default:
      return { x: 0, z: 0 };
  }
}

/**
 * Compute local offset for a slot group on an L-shape footprint.
 * Centered along hinge depth.
 */
function _lShapeGroupLocal(fp, group, childW) {
  const h = fp.hinge;
  const majorW = h.w + fp.majorThrust;
  const offX = -h.w / 2;

  switch (group.side) {
    case 'left':
      return { x: offX - SLOT_GAP - childW / 2, z: 0 };
    case 'right':
      return { x: offX + majorW + SLOT_GAP + childW / 2, z: 0 };
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
 * Get all slot group world positions for a parent item.
 * @param {Object} parentItem - SceneData item
 * @returns {Array<{ groupId: string, x: number, z: number }>}
 */
function getAllSlotGroupPositions(parentItem) {
  const config = FURNITURE[parentItem.type];
  if (!config || !config.slotGroups) return [];

  return config.slotGroups.map(group => {
    const pos = getSlotGroupWorldPosition(parentItem, group, null);
    return { groupId: group.id, x: pos.x, z: pos.z };
  });
}
