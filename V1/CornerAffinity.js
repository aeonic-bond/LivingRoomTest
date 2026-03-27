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
    this.buffer = Math.ceil(Math.min(room.width, room.height) * 0.2);
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

  /**
   * Get the movement zone bounds for a corner.
   * Zone = full room minus buffer around every other corner.
   * @param {number} cornerId
   * @returns {{ minX, minZ, maxX, maxZ }}
   */
  /**
   * Get the movement zone bounds for a corner.
   * Zone = the larger of the sectional bounding square or 60% of room,
   * extending from the corner point inward.
   * @param {number} cornerId
   * @param {Object} [footprint] - optional L-shape footprint for size-based zone
   * @returns {{ minX, minZ, maxX, maxZ }}
   */
  getZone(cornerId, footprint) {
    const corner = this.getCorner(cornerId);
    if (!corner) return { minX: 0, minZ: 0, maxX: this.room.width, maxZ: this.room.height };

    // Compute zone size per axis
    let zoneW, zoneD;
    if (footprint && footprint.type === 'L') {
      const h = footprint.hinge;
      const totalMajor = h.w + footprint.majorThrust;
      const totalMinor = h.d + footprint.minorThrust;
      const boundingSquare = Math.max(totalMajor, totalMinor);
      zoneW = Math.max(boundingSquare, this.room.width * 0.9);
      zoneD = Math.max(boundingSquare, this.room.height * 0.9);
    } else {
      zoneW = this.room.width * 0.9;
      zoneD = this.room.height * 0.9;
    }

    // Zone extends from corner point inward
    const sx = corner.normal.x > 0 ? 1 : -1;
    const sz = corner.normal.z > 0 ? 1 : -1;

    let minX, maxX, minZ, maxZ;
    if (sx > 0) {
      minX = corner.x;
      maxX = corner.x + zoneW;
    } else {
      minX = corner.x - zoneW;
      maxX = corner.x;
    }
    if (sz > 0) {
      minZ = corner.z;
      maxZ = corner.z + zoneD;
    } else {
      minZ = corner.z - zoneD;
      maxZ = corner.z;
    }

    // Clamp to room bounds
    minX = Math.max(0, minX);
    maxX = Math.min(this.room.width, maxX);
    minZ = Math.max(0, minZ);
    maxZ = Math.min(this.room.height, maxZ);

    return { minX, minZ, maxX, maxZ };
  }
}
