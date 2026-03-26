/**
 * EdgeAffinity
 *
 * Takes room geometry, generates edges with IDs, normals, and zones.
 * Provides queries for which edge zone a point is in and
 * what orientation an object should have on that edge.
 */
class EdgeAffinity {
  /**
   * @param {Object} room - a ROOMS entry with perimeter, width, height
   */
  constructor(room) {
    this.room  = room;
    this.edges = [];
    this._generateEdges();
  }

  /**
   * Walk the room perimeter and generate edges.
   * Each edge gets: id, start/end points, normal, zone depth, label.
   */
  _generateEdges() {
    const pts = this.room.perimeter;
    const n   = pts.length;

    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];

      // Edge direction
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dz * dz);

      // Inward-facing normal (perpendicular, pointing into room interior)
      const normal = { x: -dz / len, z: dx / len };

      // Zone depth = distance to room midline along the normal axis
      const zoneDepth = this._computeZoneDepth(a, b, normal);

      this.edges.push({
        id: i,
        label: 'Edge ' + String.fromCharCode(65 + i),  // Edge A, Edge B, ...
        x1: a.x,
        z1: a.z,
        x2: b.x,
        z2: b.z,
        length: len,
        normal,
        zoneDepth,
      });
    }
  }

  /**
   * Compute zone depth as distance from the edge to the room midline
   * along the edge's normal direction.
   */
  _computeZoneDepth(a, b, normal) {
    const midX = this.room.width / 2;
    const midZ = this.room.height / 2;

    // Edge midpoint
    const edgeMidX = (a.x + b.x) / 2;
    const edgeMidZ = (a.z + b.z) / 2;

    // Distance from edge midpoint to room center along the normal
    const toMidX = midX - edgeMidX;
    const toMidZ = midZ - edgeMidZ;

    // Project onto normal
    return Math.abs(toMidX * normal.x + toMidZ * normal.z);
  }

  /**
   * Get an edge by ID.
   */
  getEdge(id) {
    return this.edges[id] || null;
  }

  /**
   * Find which edge zone a point falls in.
   * Returns the edge, or null if not in any zone.
   */
  getEdgeAt(x, z) {
    for (const edge of this.edges) {
      if (this._pointInZone(x, z, edge)) return edge;
    }
    return null;
  }

  /**
   * Get the nearest edge to a point.
   */
  getNearestEdge(x, z) {
    let nearest = null;
    let minDist = Infinity;

    for (const edge of this.edges) {
      const dist = this._distToEdge(x, z, edge);
      if (dist < minDist) {
        minDist = dist;
        nearest = edge;
      }
    }
    return nearest;
  }

  /**
   * Get the rotation (in radians) for an object on a given edge.
   * Objects face inward (along the edge normal).
   */
  getRotation(edge) {
    return Math.atan2(edge.normal.x, edge.normal.z);
  }

  /**
   * Check if a point is within an edge's zone.
   */
  _pointInZone(x, z, edge) {
    // Distance from the edge line
    const dist = this._distToEdge(x, z, edge);

    // Must be on the inward side (positive dot with normal)
    const edgeMidX = (edge.x1 + edge.x2) / 2;
    const edgeMidZ = (edge.z1 + edge.z2) / 2;
    const toPointX = x - edgeMidX;
    const toPointZ = z - edgeMidZ;
    const dot = toPointX * edge.normal.x + toPointZ * edge.normal.z;

    // Also check the point is within the edge's length (project onto edge direction)
    const edgeDx = edge.x2 - edge.x1;
    const edgeDz = edge.z2 - edge.z1;
    const t = ((x - edge.x1) * edgeDx + (z - edge.z1) * edgeDz) / (edge.length * edge.length);

    return dist <= edge.zoneDepth && dot >= 0 && t >= 0 && t <= 1;
  }

  /**
   * Perpendicular distance from a point to an edge line.
   */
  _distToEdge(x, z, edge) {
    const dx = edge.x2 - edge.x1;
    const dz = edge.z2 - edge.z1;
    return Math.abs((x - edge.x1) * dz - (z - edge.z1) * dx) / edge.length;
  }
}
