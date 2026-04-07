/**
 * ParentAffinity
 *
 * Computes movement zones for child items relative to their parent.
 * Analogous to EdgeAffinity/CornerAffinity but for children on slotGroups.
 *
 * A child's zone constrains it to slide along its sub-slot region
 * of the parent's side, while staying locked at the slot offset distance.
 *
 * Stateless: zones derive entirely from parent state + slot config.
 */
class ParentAffinity {
  /**
   * Compute the movement zone for a child item.
   *
   * @param {Object} childItem - SceneData item with parentId, slotGroupId, subSlot
   * @param {SceneData} sceneData - to look up parent item
   * @returns {{ minX, minZ, maxX, maxZ, slideAxis: 'x'|'z', subSlot } | null}
   */
  static getZone(childItem, sceneData) {
    if (childItem.parentId == null || childItem.slotGroupId == null) return null;

    const parentItem = sceneData.get(childItem.parentId);
    if (!parentItem) return null;

    const parentConfig = FURNITURE[parentItem.type];
    if (!parentConfig || !parentConfig.slotGroups) return null;

    const slotConfig = parentConfig.slotGroups.find(s => s.id === childItem.slotGroupId);
    if (!slotConfig) return null;

    const subSlot = childItem.subSlot || 'back';
    const fp = parentConfig.footprint;
    const side = slotConfig.side;

    // Parent side depth
    let sideDepth;
    if (fp.type === 'L') {
      sideDepth = (side === 'left' || side === 'right') ? fp.hinge.d : fp.hinge.w;
    } else {
      sideDepth = (side === 'left' || side === 'right') ? fp.d : fp.w;
    }

    // Sub-slot center = slot center offset by ±sideDepth/4 along the edge normal
    const subSlotCenter = getSlotWorldPosition(parentItem, slotConfig, childItem.type, null, subSlot);

    // Slide range = half of sub-slot depth (sideDepth/2), minus child half-depth
    const childFp = FURNITURE[childItem.type].footprint;
    const subSlotHalf = sideDepth / 4; // half of the sub-slot region
    const childHalfD = childFp.d / 2;
    const slideRoom = Math.max(0, subSlotHalf - childHalfD);

    // Determine which world axis is the slide axis from parent rotation.
    // Parent rotation is always cardinal (0, π/2, π, 3π/2).
    // The edge normal direction = (sin(rot), cos(rot)).
    // For left/right sides, depth runs perpendicular to the normal (along the edge).
    // The slide direction (along parent depth) for left/right sides:
    //   local Z maps to world via THREE.js rotation.y convention.
    const rot = parentItem.rotation || 0;
    const cosR = Math.round(Math.cos(rot) * 1000) / 1000;
    const sinR = Math.round(Math.sin(rot) * 1000) / 1000;

    // For left/right slots: slide is along the edge (perpendicular to the normal).
    // Edge direction in world space: (-cos(rot), sin(rot)) for THREE.js rotation.y.
    // But we only need to know which world axis it aligns with.
    let slideAxis;
    if (side === 'left' || side === 'right') {
      // Slide along parent depth (local Z). In world space:
      // rotation=0: local Z → world Z → slideAxis='z'
      // rotation=π/2: local Z → world X → slideAxis='x' (actually -X)
      // rotation=π: local Z → world -Z → slideAxis='z'
      // rotation=3π/2: local Z → world -X → slideAxis='x'
      slideAxis = Math.abs(cosR) > Math.abs(sinR) ? 'z' : 'x';
    } else {
      // front/back slots: slide along parent width (local X)
      slideAxis = Math.abs(sinR) > Math.abs(cosR) ? 'z' : 'x';
    }

    // Build bounds
    let minX, maxX, minZ, maxZ;
    if (slideAxis === 'z') {
      // Slide along Z, locked on X
      minX = subSlotCenter.x;
      maxX = subSlotCenter.x;
      minZ = subSlotCenter.z - slideRoom;
      maxZ = subSlotCenter.z + slideRoom;
    } else {
      // Slide along X, locked on Z
      minX = subSlotCenter.x - slideRoom;
      maxX = subSlotCenter.x + slideRoom;
      minZ = subSlotCenter.z;
      maxZ = subSlotCenter.z;
    }

    return { minX, minZ, maxX, maxZ, slideAxis, subSlot };
  }
}
