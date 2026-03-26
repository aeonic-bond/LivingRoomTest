/**
 * CornerAffinity
 *
 * Takes room geometry, generates corners from perimeter vertices.
 * Each corner is the intersection of two edges.
 * Provides queries for nearest corner, major/minor edge assignment,
 * and directional signs for L-shape orientation.
 */
class CornerAffinity {
  /**
   * @param {Object} room - a ROOMS entry with perimeter, width, height
   * @param {EdgeAffinity} edgeAffinity - to reference edge data
   */
  constructor(room, edgeAffinity) {
    this.room   = room;
    this.edges  = edgeAffinity;
    this.corners = [];
    this._generateCorners();
  }

  /**
   * Walk the perimeter vertices. Each vertex is a corner
   * where two edges meet.
   */
  _generateCorners() {
    const pts = this.room.perimeter;
    const n   = pts.length;
    const edgeList = this.edges.edges;

    for (let i = 0; i < n; i++) {
      const point = pts[i];

      // Edge ending at this vertex (previous edge)
      const prevEdgeIdx = (i - 1 + n) % n;
      // Edge starting from this vertex (current edge)
      const nextEdgeIdx = i;

      const prevEdge = edgeList[prevEdgeIdx];
      const nextEdge = edgeList[nextEdgeIdx];

      // Inward direction: average of the two edge normals, normalized
      const nx = prevEdge.normal.x + nextEdge.normal.x;
      const nz = prevEdge.normal.z + nextEdge.normal.z;
      const len = Math.sqrt(nx * nx + nz * nz) || 1;
      const normalX = nx / len;
      const normalZ = nz / len;

      // Edge directions (along each edge, pointing inward from the corner)
      // prevEdge ends at this corner — its direction points toward this corner
      // nextEdge starts at this corner — its direction points away from this corner
      const prevDir = {
        x: (prevEdge.x2 - prevEdge.x1) / prevEdge.length,
        z: (prevEdge.z2 - prevEdge.z1) / prevEdge.length,
      };
      const nextDir = {
        x: (nextEdge.x2 - nextEdge.x1) / nextEdge.length,
        z: (nextEdge.z2 - nextEdge.z1) / nextEdge.length,
      };

      this.corners.push({
        id: i,
        label: 'Corner ' + i,
        x: point.x,
        z: point.z,
        edgeIds: [prevEdge.id, nextEdge.id],
        normal: { x: normalX, z: normalZ },
        // Directions along each edge (away from corner, into room)
        edgeDirs: [
          { x: -prevDir.x, z: -prevDir.z },  // prevEdge: reverse (toward room)
          { x: nextDir.x, z: nextDir.z },     // nextEdge: forward (toward room)
        ],
      });
    }
  }

  /**
   * Get a corner by ID.
   */
  getCorner(id) {
    return this.corners[id] || null;
  }

  /**
   * Get the nearest corner to a point, with major/minor edge assignment.
   * Major edge = the corner's edge that the click point is closer to.
   * Also provides sx, sz signs for L-shape block construction.
   * @returns {{ corner, majorEdgeId, minorEdgeId, sx, sz } | null}
   */
  getNearestCorner(x, z) {
    let nearest = null;
    let minDist = Infinity;

    for (const corner of this.corners) {
      const dx = x - corner.x;
      const dz = z - corner.z;
      const dist = dx * dx + dz * dz;
      if (dist < minDist) {
        minDist = dist;
        nearest = corner;
      }
    }

    if (!nearest) return null;

    // Determine major/minor: which of the two edges is the click closer to
    const edgeA = this.edges.getEdge(nearest.edgeIds[0]);
    const edgeB = this.edges.getEdge(nearest.edgeIds[1]);
    const distA = this.edges._distToEdge(x, z, edgeA);
    const distB = this.edges._distToEdge(x, z, edgeB);

    // Major thrust extends along the closer edge's direction
    // Minor thrust extends along the other edge's direction
    const majorIdx = distA <= distB ? 0 : 1;
    const minorIdx = distA <= distB ? 1 : 0;

    return {
      corner:      nearest,
      majorEdgeId: nearest.edgeIds[majorIdx],
      minorEdgeId: nearest.edgeIds[minorIdx],
      majorDir:    nearest.edgeDirs[majorIdx],
      minorDir:    nearest.edgeDirs[minorIdx],
    };
  }
}
