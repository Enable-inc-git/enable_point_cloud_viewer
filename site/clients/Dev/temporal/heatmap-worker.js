/**
 * heatmap-worker.js
 * Web Worker for temporal scan heat map computation.
 * Builds a k-d tree from Scan A, computes distances for each Scan B point.
 * Supports point-to-point and point-to-surface modes.
 */

'use strict';

/* =========================================================
   K-D TREE (3D, built from flat Float32Array)
   ========================================================= */

function buildKdTree(positions, count) {
  // Build array of indices, sort by splitting axis at each level
  var indices = new Uint32Array(count);
  for (var i = 0; i < count; i++) indices[i] = i;

  var nodes = []; // flat array: { splitAxis, splitVal, left, right, startIdx, endIdx (leaf) }

  function build(idxStart, idxEnd, depth) {
    var nodeId = nodes.length;
    nodes.push(null); // placeholder

    var size = idxEnd - idxStart;
    if (size <= 16) {
      // leaf node
      nodes[nodeId] = { leaf: true, start: idxStart, end: idxEnd };
      return nodeId;
    }

    var axis = depth % 3;

    // find median by partial sort (nth_element approximation via full sort on axis)
    var subIndices = indices.subarray(idxStart, idxEnd);
    var off = axis;
    subIndices.sort(function (a, b) {
      return positions[a * 3 + off] - positions[b * 3 + off];
    });

    var mid = idxStart + (size >> 1);
    var splitVal = positions[indices[mid] * 3 + axis];

    var left = build(idxStart, mid, depth + 1);
    var right = build(mid, idxEnd, depth + 1);

    nodes[nodeId] = { leaf: false, axis: axis, split: splitVal, left: left, right: right };
    return nodeId;
  }

  build(0, count, 0);

  return { nodes: nodes, indices: indices, positions: positions };
}

function kdNearest1(tree, qx, qy, qz) {
  var bestDist = Infinity;
  var bestIdx = -1;
  var nodes = tree.nodes;
  var indices = tree.indices;
  var pos = tree.positions;

  function search(nodeId) {
    var node = nodes[nodeId];
    if (node.leaf) {
      for (var i = node.start; i < node.end; i++) {
        var idx = indices[i];
        var dx = pos[idx * 3] - qx;
        var dy = pos[idx * 3 + 1] - qy;
        var dz = pos[idx * 3 + 2] - qz;
        var d = dx * dx + dy * dy + dz * dz;
        if (d < bestDist) { bestDist = d; bestIdx = idx; }
      }
      return;
    }

    var q = (node.axis === 0) ? qx : (node.axis === 1) ? qy : qz;
    var diff = q - node.split;
    var first = diff <= 0 ? node.left : node.right;
    var second = diff <= 0 ? node.right : node.left;

    search(first);
    if (diff * diff < bestDist) search(second);
  }

  search(0);
  return { index: bestIdx, distSq: bestDist };
}

function kdNearestK(tree, qx, qy, qz, k) {
  // Returns up to k nearest neighbors as array of { index, distSq }
  var heap = []; // max-heap by distSq, max size k
  var nodes = tree.nodes;
  var indices = tree.indices;
  var pos = tree.positions;

  function heapPush(idx, distSq) {
    if (heap.length < k) {
      heap.push({ index: idx, distSq: distSq });
      // bubble up
      var i = heap.length - 1;
      while (i > 0) {
        var parent = (i - 1) >> 1;
        if (heap[i].distSq > heap[parent].distSq) {
          var tmp = heap[i]; heap[i] = heap[parent]; heap[parent] = tmp;
          i = parent;
        } else break;
      }
    } else if (distSq < heap[0].distSq) {
      heap[0] = { index: idx, distSq: distSq };
      // sift down
      var n = heap.length;
      var i = 0;
      while (true) {
        var l = 2 * i + 1, r = 2 * i + 2, largest = i;
        if (l < n && heap[l].distSq > heap[largest].distSq) largest = l;
        if (r < n && heap[r].distSq > heap[largest].distSq) largest = r;
        if (largest !== i) {
          var tmp = heap[i]; heap[i] = heap[largest]; heap[largest] = tmp;
          i = largest;
        } else break;
      }
    }
  }

  function heapMaxDist() {
    return heap.length < k ? Infinity : heap[0].distSq;
  }

  function search(nodeId) {
    var node = nodes[nodeId];
    if (node.leaf) {
      for (var i = node.start; i < node.end; i++) {
        var idx = indices[i];
        var dx = pos[idx * 3] - qx;
        var dy = pos[idx * 3 + 1] - qy;
        var dz = pos[idx * 3 + 2] - qz;
        var d = dx * dx + dy * dy + dz * dz;
        heapPush(idx, d);
      }
      return;
    }

    var q = (node.axis === 0) ? qx : (node.axis === 1) ? qy : qz;
    var diff = q - node.split;
    var first = diff <= 0 ? node.left : node.right;
    var second = diff <= 0 ? node.right : node.left;

    search(first);
    if (diff * diff < heapMaxDist()) search(second);
  }

  search(0);
  return heap;
}

/* =========================================================
   POINT-TO-SURFACE DISTANCE (local plane fit)
   ========================================================= */

/**
 * Returns { signedDist, reliable, normalA } where:
 *  - signedDist = signed perpendicular distance to local fitted plane
 *    (positive = query point is on the side the normal points toward)
 *  - reliable = false if neighbors are too far (different geometry)
 *  - normalA = the reference surface normal (for normal consistency check)
 */
function pointToSurfaceDistance(tree, posA, qx, qy, qz, k, maxNeighborDist) {
  var neighbors = kdNearestK(tree, qx, qy, qz, k);
  var n = neighbors.length;
  if (n < 3) {
    var nn = kdNearest1(tree, qx, qy, qz);
    var d = Math.sqrt(nn.distSq);
    return { signedDist: d, reliable: true, normalA: null };
  }

  // Check: are the neighbors actually close?
  var neighborDists = [];
  for (var i = 0; i < n; i++) {
    neighborDists.push(Math.sqrt(neighbors[i].distSq));
  }
  neighborDists.sort(function (a, b) { return a - b; });
  var medianNeighborDist = neighborDists[Math.floor(n / 2)];

  if (medianNeighborDist > maxNeighborDist) {
    return { signedDist: medianNeighborDist, reliable: false, normalA: null };
  }

  // Compute centroid of neighbors
  var cx = 0, cy = 0, cz = 0;
  for (var i = 0; i < n; i++) {
    var idx = neighbors[i].index;
    cx += posA[idx * 3];
    cy += posA[idx * 3 + 1];
    cz += posA[idx * 3 + 2];
  }
  cx /= n; cy /= n; cz /= n;

  // Build covariance matrix (symmetric 3x3)
  var cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
  for (var i = 0; i < n; i++) {
    var idx = neighbors[i].index;
    var dx = posA[idx * 3] - cx;
    var dy = posA[idx * 3 + 1] - cy;
    var dz = posA[idx * 3 + 2] - cz;
    cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
    cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
  }

  var normal = smallestEigenvector3x3(cxx, cxy, cxz, cyy, cyz, czz);

  // Orient normal with consistent convention:
  // Z-positive for floors/ceilings, Y-positive for front/back walls, X-positive for side walls.
  // This gives: floor heave up = positive, settlement = negative.
  if (normal[2] < -1e-6) {
    normal[0] = -normal[0]; normal[1] = -normal[1]; normal[2] = -normal[2];
  } else if (Math.abs(normal[2]) < 1e-6) {
    if (normal[1] < -1e-6) {
      normal[0] = -normal[0]; normal[1] = -normal[1]; normal[2] = -normal[2];
    } else if (Math.abs(normal[1]) < 1e-6 && normal[0] < 0) {
      normal[0] = -normal[0]; normal[1] = -normal[1]; normal[2] = -normal[2];
    }
  }

  // Check planarity via RMS residual
  var rmsResidual = 0;
  for (var i = 0; i < n; i++) {
    var idx = neighbors[i].index;
    var px = posA[idx * 3] - cx;
    var py = posA[idx * 3 + 1] - cy;
    var pz = posA[idx * 3 + 2] - cz;
    var r = px * normal[0] + py * normal[1] + pz * normal[2];
    rmsResidual += r * r;
  }
  rmsResidual = Math.sqrt(rmsResidual / n);

  var neighborSpread = neighborDists[n - 1];
  if (neighborSpread > 0 && rmsResidual / neighborSpread > 0.15) {
    // Edge/corner — fall back to point-to-point (unsigned, positive magnitude)
    var nn = kdNearest1(tree, qx, qy, qz);
    var d = Math.sqrt(nn.distSq);
    return { signedDist: d, reliable: true, normalA: normal };
  }

  // Signed distance: projection of (query - centroid) onto the oriented normal
  var signedDist = (qx - cx) * normal[0] + (qy - cy) * normal[1] + (qz - cz) * normal[2];

  return { signedDist: signedDist, reliable: true, normalA: normal };
}

/**
 * Find the eigenvector corresponding to the smallest eigenvalue
 * of a 3x3 symmetric matrix using the characteristic polynomial.
 */
function smallestEigenvector3x3(a00, a01, a02, a11, a12, a22) {
  // Characteristic polynomial: det(A - λI) = 0
  // -λ³ + (a00+a11+a22)λ² - (a00*a11+a00*a22+a11*a22 - a01²-a02²-a12²)λ + det(A) = 0

  var trace = a00 + a11 + a22;
  var q = trace / 3;

  var b00 = a00 - q, b11 = a11 - q, b22 = a22 - q;
  var p2 = b00 * b00 + b11 * b11 + b22 * b22 + 2 * (a01 * a01 + a02 * a02 + a12 * a12);
  var p = Math.sqrt(p2 / 6);

  if (p < 1e-15) {
    // Matrix is already diagonal (or zero) — all eigenvalues equal
    return [0, 0, 1];
  }

  // B = (1/p) * (A - qI)
  var invP = 1 / p;
  var B00 = b00 * invP, B01 = a01 * invP, B02 = a02 * invP;
  var B11 = b11 * invP, B12 = a12 * invP, B22 = b22 * invP;

  var detB = B00 * (B11 * B22 - B12 * B12)
           - B01 * (B01 * B22 - B12 * B02)
           + B02 * (B01 * B12 - B11 * B02);

  var halfDetB = detB / 2;
  halfDetB = Math.max(-1, Math.min(1, halfDetB));

  var phi = Math.acos(halfDetB) / 3;

  // Eigenvalues: λ0 <= λ1 <= λ2
  var lambda0 = q + 2 * p * Math.cos(phi + 2 * Math.PI / 3); // smallest

  // Find eigenvector for lambda0 via (A - lambda0*I) null space
  var m00 = a00 - lambda0, m01 = a01, m02 = a02;
  var m10 = a01, m11 = a11 - lambda0, m12 = a12;
  var m20 = a02, m21 = a12, m22 = a22 - lambda0;

  // Cross product of two rows to get normal to null space
  var nx, ny, nz;

  // Try rows 0 and 1
  nx = m01 * m12 - m02 * m11;
  ny = m02 * m10 - m00 * m12;
  nz = m00 * m11 - m01 * m10;
  var len = Math.sqrt(nx * nx + ny * ny + nz * nz);

  if (len < 1e-12) {
    // Try rows 0 and 2
    nx = m01 * m22 - m02 * m21;
    ny = m02 * m20 - m00 * m22;
    nz = m00 * m21 - m01 * m20;
    len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  }

  if (len < 1e-12) {
    // Try rows 1 and 2
    nx = m11 * m22 - m12 * m21;
    ny = m12 * m20 - m10 * m22;
    nz = m10 * m21 - m11 * m20;
    len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  }

  if (len < 1e-12) {
    return [0, 0, 1]; // degenerate fallback
  }

  return [nx / len, ny / len, nz / len];
}

/* =========================================================
   COMPUTE LOCAL SURFACE NORMAL from K neighbors in a tree
   ========================================================= */

function computeLocalNormal(tree, positions, qx, qy, qz, k) {
  var neighbors = kdNearestK(tree, qx, qy, qz, k);
  var n = neighbors.length;
  if (n < 3) return null;

  var cx = 0, cy = 0, cz = 0;
  for (var i = 0; i < n; i++) {
    var idx = neighbors[i].index;
    cx += positions[idx * 3];
    cy += positions[idx * 3 + 1];
    cz += positions[idx * 3 + 2];
  }
  cx /= n; cy /= n; cz /= n;

  var cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
  for (var i = 0; i < n; i++) {
    var idx = neighbors[i].index;
    var dx = positions[idx * 3] - cx;
    var dy = positions[idx * 3 + 1] - cy;
    var dz = positions[idx * 3 + 2] - cz;
    cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
    cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
  }

  return smallestEigenvector3x3(cxx, cxy, cxz, cyy, cyz, czz);
}

/* =========================================================
   MAIN WORKER MESSAGE HANDLER
   ========================================================= */

var cancelled = false;

self.onmessage = function (e) {
  var msg = e.data;

  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (msg.type === 'compute') {
    cancelled = false;
    var posA = new Float32Array(msg.scanA.positions);
    var countA = msg.scanA.count;
    var posB = new Float32Array(msg.scanB.positions);
    var countB = msg.scanB.count;
    var settings = msg.settings;

    // Phase 1: Build k-d trees on both scans
    self.postMessage({ type: 'progress', percent: 0, phase: 'building-tree' });

    var treeA = buildKdTree(posA, countA);

    if (cancelled) { self.postMessage({ type: 'error', message: 'Cancelled' }); return; }

    self.postMessage({ type: 'progress', percent: 5, phase: 'building-tree' });

    var treeB = buildKdTree(posB, countB);

    if (cancelled) { self.postMessage({ type: 'error', message: 'Cancelled' }); return; }

    self.postMessage({ type: 'progress', percent: 10, phase: 'computing' });

    // Phase 2: Compute distances for Scan B points
    var subsample = settings.subsample || 1;

    var distances = new Float32Array(countB);
    for (var i = 0; i < countB; i++) distances[i] = -1;

    var totalToProcess = Math.ceil(countB / subsample);
    var processed = 0;
    var lastProgress = 10;

    // Crop box filter: only process points within the box
    var cropBox = settings.cropBox || null;

    for (var i = 0; i < countB; i += subsample) {
      if (cancelled) { self.postMessage({ type: 'error', message: 'Cancelled' }); return; }

      var qx = posB[i * 3];
      var qy = posB[i * 3 + 1];
      var qz = posB[i * 3 + 2];

      // Skip points outside crop box
      if (cropBox) {
        if (qx < cropBox.min[0] || qx > cropBox.max[0] ||
            qy < cropBox.min[1] || qy > cropBox.max[1] ||
            qz < cropBox.min[2] || qz > cropBox.max[2]) {
          continue;
        }
      }

      // Point-to-point with signed distance
      var nn = kdNearest1(treeA, qx, qy, qz);
      var dist = Math.sqrt(nn.distSq);

      // Compute reference surface normal for sign direction
      var refNormal = computeLocalNormal(treeA, posA, qx, qy, qz, 12);

      if (refNormal) {
        // Orient normal Z-positive
        if (refNormal[2] < -1e-6) {
          refNormal[0] = -refNormal[0]; refNormal[1] = -refNormal[1]; refNormal[2] = -refNormal[2];
        } else if (Math.abs(refNormal[2]) < 1e-6) {
          if (refNormal[1] < -1e-6) {
            refNormal[0] = -refNormal[0]; refNormal[1] = -refNormal[1]; refNormal[2] = -refNormal[2];
          }
        }
        var nnIdx = nn.index;
        var dx = qx - posA[nnIdx * 3];
        var dy = qy - posA[nnIdx * 3 + 1];
        var dz = qz - posA[nnIdx * 3 + 2];
        var sign = (dx * refNormal[0] + dy * refNormal[1] + dz * refNormal[2]) >= 0 ? 1 : -1;
        distances[i] = sign * dist * 1000;
      } else {
        distances[i] = dist * 1000;
      }

      processed++;
      var pct = 10 + Math.floor((processed / totalToProcess) * 88);
      if (pct > lastProgress + 1) {
        lastProgress = pct;
        self.postMessage({ type: 'progress', percent: pct, phase: 'computing' });
      }
    }

    // If subsampled, interpolate skipped points with nearest computed value
    if (subsample > 1) {
      for (var i = 0; i < countB; i++) {
        if (distances[i] === -1) {
          var prev = i - (i % subsample);
          if (prev >= 0 && prev < countB && distances[prev] !== -1) {
            distances[i] = distances[prev];
          }
        }
      }
    }

    self.postMessage({ type: 'progress', percent: 96, phase: 'smoothing' });

    // Median filter for noise (K=7).
    var smoothK = 7;
    var smoothed = new Float32Array(countB);
    for (var i = 0; i < countB; i++) {
      if (distances[i] <= -99000 || distances[i] === -1) {
        smoothed[i] = distances[i];
        continue;
      }
      var qx = posB[i * 3];
      var qy = posB[i * 3 + 1];
      var qz = posB[i * 3 + 2];
      var neighbors = kdNearestK(treeB, qx, qy, qz, smoothK);
      var vals = [];
      for (var j = 0; j < neighbors.length; j++) {
        var ni = neighbors[j].index;
        if (distances[ni] > -99000 && distances[ni] !== -1) {
          vals.push(distances[ni]);
        }
      }
      if (vals.length >= 3) {
        vals.sort(function (a, b) { return a - b; });
        smoothed[i] = vals[Math.floor(vals.length / 2)];
      } else {
        smoothed[i] = distances[i];
      }
    }

    // Count how many were flagged as foreign
    var foreignCount = 0;
    for (var i = 0; i < countB; i++) {
      if (smoothed[i] <= -99000) foreignCount++;
    }

    self.postMessage({ type: 'progress', percent: 100, phase: 'done' });
    self.postMessage(
      { type: 'complete', distances: smoothed.buffer, foreignCount: foreignCount },
      [smoothed.buffer]
    );
  }
};
