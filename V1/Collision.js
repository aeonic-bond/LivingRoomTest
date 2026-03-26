/**
 * Collision
 *
 * Stateless utility for footprint overlap detection.
 * Used by TransformController (soft bounce) and PlacingMenu (block placement).
 */
const Collision = {

  /**
   * Get the axis-aligned bounding rectangles for an item's footprint in world space.
   * Returns an array of { minX, minZ, maxX, maxZ }.
   * @param {string} type - furniture type id
   * @param {number} x - item world x
   * @param {number} z - item world z
   * @param {Object} item - full item data (for rotation, sx, sz)
   */
  getWorldRects(type, x, z, item) {
    const config = FURNITURE[type];
    if (!config) return [];

    const fp = config.footprint;

    if (fp.type === 'L') {
      const h = fp.hinge;
      const sx = item.sx || 1;
      const sz = item.sz || 1;

      // Hinge centered on item position
      const hx0 = x - (h.w / 2) * sx;
      const hz0 = z - (h.d / 2) * sz;

      // Hinge rect
      const hingeRect = Collision._makeRect(hx0, hz0, h.w * sx, h.d * sz);

      // Major arm (hinge + thrust along major direction)
      const majorRect = Collision._makeRect(hx0, hz0, (h.w + fp.majorThrust) * sx, h.d * sz);

      // Minor arm (hinge + thrust along minor direction)
      const minorRect = Collision._makeRect(hx0, hz0, h.w * sx, (h.d + fp.minorThrust) * sz);

      return [majorRect, minorRect];
    }

    // Rect footprint — account for rotation
    const cosR = Math.abs(Math.cos(item.rotation || 0));
    const sinR = Math.abs(Math.sin(item.rotation || 0));
    const halfX = (fp.w * cosR + fp.d * sinR) / 2;
    const halfZ = (fp.w * sinR + fp.d * cosR) / 2;

    return [{
      minX: x - halfX,
      minZ: z - halfZ,
      maxX: x + halfX,
      maxZ: z + halfZ,
    }];
  },

  /**
   * Normalize a rect from potentially negative w/d.
   */
  _makeRect(x, z, w, d) {
    const x0 = Math.min(x, x + w);
    const x1 = Math.max(x, x + w);
    const z0 = Math.min(z, z + d);
    const z1 = Math.max(z, z + d);
    return { minX: x0, minZ: z0, maxX: x1, maxZ: z1 };
  },

  /**
   * Check if two axis-aligned rects overlap.
   */
  rectsOverlap(a, b) {
    return a.minX < b.maxX && a.maxX > b.minX &&
           a.minZ < b.maxZ && a.maxZ > b.minZ;
  },

  /**
   * Check if two items' footprints overlap.
   */
  itemsOverlap(typeA, xA, zA, itemA, typeB, xB, zB, itemB) {
    const rectsA = Collision.getWorldRects(typeA, xA, zA, itemA);
    const rectsB = Collision.getWorldRects(typeB, xB, zB, itemB);

    for (const a of rectsA) {
      for (const b of rectsB) {
        if (Collision.rectsOverlap(a, b)) return true;
      }
    }
    return false;
  },

  /**
   * Find all items in sceneData that overlap with a given footprint.
   * @param {string} type - furniture type
   * @param {number} x - world x
   * @param {number} z - world z
   * @param {Object} itemData - item-like object with rotation, sx, sz
   * @param {SceneData} sceneData
   * @param {number|null} excludeId - item id to skip (e.g. the item being dragged)
   * @returns {Array} overlapping items
   */
  findOverlaps(type, x, z, itemData, sceneData, excludeId) {
    const results = [];
    for (const other of sceneData.items) {
      if (other.id === excludeId) continue;
      if (Collision.itemsOverlap(type, x, z, itemData, other.type, other.x, other.z, other)) {
        results.push(other);
      }
    }
    return results;
  },
};
