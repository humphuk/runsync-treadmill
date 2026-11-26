/**
 * Pure Three.js-ready BufferGeometry builders for non-twisting road ribbons
 * and Hermite road-to-terrain vertex carving.
 */

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Build indexed typed-array buffers for a road ribbon with sloped verge shoulders
 * from up-vector-stabilized route samples.
 *
 * @param {Array<{ x: number, y: number, z: number, s: number, right: [number, number, number] }>} samples
 * @param {{ widthM?: number, shoulderM?: number, yOffset?: number, shoulderDropM?: number }} [opts]
 * @returns {{
 *   positions: Float32Array,
 *   normals: Float32Array,
 *   uvs: Float32Array,
 *   indices: Uint32Array,
 *   vertexCount: number,
 *   triangleCount: number,
 * }}
 */
export function buildRoadRibbonGeometry(
  samples,
  { widthM = 6, shoulderM = 1, yOffset = 0.04, shoulderDropM = 0.16 } = {},
) {
  if (!Array.isArray(samples) || samples.length < 2) {
    throw new Error('buildRoadRibbonGeometry requires at least 2 route samples');
  }

  const hasShoulder = shoulderM > 0;
  const cols = hasShoulder ? 4 : 2;
  const halfW = widthM * 0.5;
  const totalWidth = widthM + (hasShoulder ? shoulderM * 2 : 0);

  const vertexCount = samples.length * cols;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let i = 0; i < samples.length; i += 1) {
    const smp = samples[i];
    const [rx, ry, rz] = smp.right ?? [1, 0, 0];
    const vCoord = smp.s / Math.max(0.5, widthM);

    const offsets = hasShoulder
      ? [
          { lat: -(halfW + shoulderM), yDrop: -shoulderDropM, u: 0 },
          { lat: -halfW, yDrop: 0, u: shoulderM / totalWidth },
          { lat: halfW, yDrop: 0, u: (shoulderM + widthM) / totalWidth },
          { lat: halfW + shoulderM, yDrop: -shoulderDropM, u: 1 },
        ]
      : [
          { lat: -halfW, yDrop: 0, u: 0 },
          { lat: halfW, yDrop: 0, u: 1 },
        ];

    for (let c = 0; c < cols; c += 1) {
      const vIdx = i * cols + c;
      const spec = offsets[c];
      positions[vIdx * 3] = smp.x + rx * spec.lat;
      positions[vIdx * 3 + 1] = smp.y + yOffset + ry * spec.lat + spec.yDrop;
      positions[vIdx * 3 + 2] = smp.z + rz * spec.lat;

      normals[vIdx * 3] = 0;
      normals[vIdx * 3 + 1] = 1;
      normals[vIdx * 3 + 2] = 0;

      uvs[vIdx * 2] = spec.u;
      uvs[vIdx * 2 + 1] = vCoord;
    }
  }

  const quadsPerSeg = cols - 1;
  const segCount = samples.length - 1;
  const indices = new Uint32Array(segCount * quadsPerSeg * 6);
  let idxPtr = 0;

  for (let i = 0; i < segCount; i += 1) {
    const row0 = i * cols;
    const row1 = (i + 1) * cols;
    for (let c = 0; c < quadsPerSeg; c += 1) {
      const a = row0 + c;
      const b = row0 + c + 1;
      const d = row1 + c;
      const e = row1 + c + 1;

      indices[idxPtr] = a;
      indices[idxPtr + 1] = b;
      indices[idxPtr + 2] = d;

      indices[idxPtr + 3] = b;
      indices[idxPtr + 4] = e;
      indices[idxPtr + 5] = d;
      idxPtr += 6;
    }
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    vertexCount,
    triangleCount: indices.length / 3,
  };
}

/**
 * Smoothly carve a route corridor into an interleaved `Float32Array` terrain vertex
 * buffer (`[x0, y0, z0, ...]`), eliminating floating roads and z-fighting.
 *
 * @param {Float32Array} terrainPositions
 * @param {Array<{ x: number, y: number, z: number }>} routeSamples
 * @param {{ halfRoadWidthM?: number, blendWidthM?: number, roadClearanceM?: number }} [opts]
 * @returns {{ modifiedCount: number }}
 */
export function carveRoadIntoTerrain(
  terrainPositions,
  routeSamples,
  { halfRoadWidthM = 3.5, blendWidthM = 8, roadClearanceM = 0.05 } = {},
) {
  if (!routeSamples || routeSamples.length === 0) {
    return { modifiedCount: 0 };
  }

  const maxDist = halfRoadWidthM + blendWidthM;
  const maxDistSq = maxDist * maxDist;
  let modifiedCount = 0;

  for (let v = 0; v < terrainPositions.length; v += 3) {
    const vx = terrainPositions[v];
    const vy = terrainPositions[v + 1];
    const vz = terrainPositions[v + 2];

    let bestDistSq = Infinity;
    let bestRoadY = vy;

    if (routeSamples.length === 1) {
      const dx = vx - routeSamples[0].x;
      const dz = vz - routeSamples[0].z;
      bestDistSq = dx * dx + dz * dz;
      bestRoadY = routeSamples[0].y;
    } else {
      for (let i = 0; i < routeSamples.length - 1; i += 1) {
        const a = routeSamples[i];
        const b = routeSamples[i + 1];

        // Quick AABB reject in XZ before segment projection
        const minX = (a.x < b.x ? a.x : b.x) - maxDist;
        const maxX = (a.x > b.x ? a.x : b.x) + maxDist;
        if (vx < minX || vx > maxX) continue;

        const minZ = (a.z < b.z ? a.z : b.z) - maxDist;
        const maxZ = (a.z > b.z ? a.z : b.z) + maxDist;
        if (vz < minZ || vz > maxZ) continue;

        const segDx = b.x - a.x;
        const segDz = b.z - a.z;
        const segLenSq = segDx * segDx + segDz * segDz;
        const t =
          segLenSq > 1e-6
            ? Math.max(0, Math.min(1, ((vx - a.x) * segDx + (vz - a.z) * segDz) / segLenSq))
            : 0;

        const px = a.x + segDx * t;
        const pz = a.z + segDz * t;
        const distSq = (vx - px) * (vx - px) + (vz - pz) * (vz - pz);

        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestRoadY = a.y + (b.y - a.y) * t;
        }
      }
    }

    if (bestDistSq < maxDistSq) {
      const dist = Math.sqrt(bestDistSq);
      const targetBedY = bestRoadY - roadClearanceM;
      const blend = smoothstep(halfRoadWidthM, maxDist, dist);
      terrainPositions[v + 1] = targetBedY + (vy - targetBedY) * blend;
      modifiedCount += 1;
    }
  }

  return { modifiedCount };
}
