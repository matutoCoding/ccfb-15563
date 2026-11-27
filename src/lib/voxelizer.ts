import type { LoadedModelSource, VoxelGrid } from '../types';
import { createGrid } from './utils';

export interface VoxelBounds {
  minX: number;
  minY: number;
  minZ: number;
  voxel: number;
  nx: number;
  ny: number;
  nz: number;
}

export function computeVoxelBounds(source: LoadedModelSource, resolution: number): VoxelBounds {
  const p = source.positions;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const sx = Math.max(1e-6, maxX - minX);
  const sy = Math.max(1e-6, maxY - minY);
  const sz = Math.max(1e-6, maxZ - minZ);
  const maxDim = Math.max(sx, sy, sz);
  // Four padded cells keep ears, tails and supports away from the grid border.
  const voxel = maxDim / Math.max(16, resolution - 6);
  const pad = 2;
  return {
    minX: minX - pad * voxel,
    minY: minY - pad * voxel,
    minZ: minZ - pad * voxel,
    voxel,
    nx: Math.ceil(sx / voxel) + pad * 2,
    ny: Math.ceil(sy / voxel) + pad * 2,
    nz: Math.ceil(sz / voxel) + pad * 2,
  };
}

type V3 = [number, number, number];

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function addScaled(a: V3, b: V3, s: number): V3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function closestPointOnTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;

  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return addScaled(a, ab, v);
  }

  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return addScaled(a, ac, w);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    const bc = sub(c, b);
    return addScaled(b, bc, w);
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

export interface SeedVoxels {
  bounds: VoxelBounds;
  seed: Uint8Array;
  accR: Uint32Array;
  accG: Uint32Array;
  accB: Uint32Array;
  accN: Uint32Array;
  backend: 'cpu' | 'webgpu';
  gpuMs?: number;
}

export function createSeedArrays(bounds: VoxelBounds) {
  const n = bounds.nx * bounds.ny * bounds.nz;
  return {
    seed: new Uint8Array(n),
    accR: new Uint32Array(n),
    accG: new Uint32Array(n),
    accB: new Uint32Array(n),
    accN: new Uint32Array(n),
  };
}

export function voxelizeCpu(source: LoadedModelSource, resolution: number): SeedVoxels {
  const bounds = computeVoxelBounds(source, resolution);
  const { nx, ny, nz, voxel, minX, minY, minZ } = bounds;
  const arrays = createSeedArrays(bounds);
  const { seed, accR, accG, accB, accN } = arrays;
  const idx = (x: number, y: number, z: number) => x + nx * (z + nz * y);
  const radiusSq = (voxel * 0.82) ** 2;
  const positions = source.positions;
  const colors = source.colors;
  const indices = source.indices;

  for (let ti = 0; ti < indices.length; ti += 3) {
    const ia = indices[ti] * 3;
    const ib = indices[ti + 1] * 3;
    const ic = indices[ti + 2] * 3;
    const a: V3 = [positions[ia], positions[ia + 1], positions[ia + 2]];
    const b: V3 = [positions[ib], positions[ib + 1], positions[ib + 2]];
    const c: V3 = [positions[ic], positions[ic + 1], positions[ic + 2]];
    const ar = (colors[ia] + colors[ib] + colors[ic]) / 3;
    const ag = (colors[ia + 1] + colors[ib + 1] + colors[ic + 1]) / 3;
    const ab = (colors[ia + 2] + colors[ib + 2] + colors[ic + 2]) / 3;

    const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - minX) / voxel) - 1);
    const x1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - minX) / voxel) + 1);
    const y0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - minY) / voxel) - 1);
    const y1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1], c[1]) - minY) / voxel) + 1);
    const z0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - minZ) / voxel) - 1);
    const z1 = Math.min(nz - 1, Math.ceil((Math.max(a[2], b[2], c[2]) - minZ) / voxel) + 1);

    for (let y = y0; y <= y1; y++) {
      const py = minY + (y + 0.5) * voxel;
      for (let z = z0; z <= z1; z++) {
        const pz = minZ + (z + 0.5) * voxel;
        for (let x = x0; x <= x1; x++) {
          const px = minX + (x + 0.5) * voxel;
          const p: V3 = [px, py, pz];
          const q = closestPointOnTriangle(p, a, b, c);
          const dx = p[0] - q[0];
          const dy = p[1] - q[1];
          const dz = p[2] - q[2];
          if (dx * dx + dy * dy + dz * dz <= radiusSq) {
            const i = idx(x, y, z);
            seed[i] = 1;
            accR[i] += ar;
            accG[i] += ag;
            accB[i] += ab;
            accN[i]++;
          }
        }
      }
    }
  }

  return { bounds, ...arrays, backend: 'cpu' };
}

const NEIGHBORS_26: Array<[number, number, number]> = [];
for (let dy = -1; dy <= 1; dy++)
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) NEIGHBORS_26.push([dx, dy, dz]);

/**
 * Turn conservative surface seeds into a thick but hollow shell.
 * Dilation is deliberately additive: a one-voxel-thin feature can never be
 * eroded away, and repair mode bridges diagonal voxel gaps.
 */
export function finalizeShell(
  seeds: SeedVoxels,
  shellThickness: number,
  repairThin: boolean,
  hollow: boolean,
): VoxelGrid {
  const { bounds, seed, accR, accG, accB, accN } = seeds;
  const { nx, ny, nz } = bounds;
  const n = nx * ny * nz;
  const grid = createGrid(nx, ny, nz);
  const effectiveThickness = repairThin ? Math.max(2, shellThickness) : shellThickness;

  // A non-hollow conversion still uses the surface band; interior fill can be
  // added by a flood pass later. For brick saving the default is hollow.
  const maxDistance = hollow ? effectiveThickness - 1 : Math.max(2, effectiveThickness * 2);
  const distance = new Uint8Array(n).fill(255);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;

  for (let i = 0; i < n; i++) {
    if (!seed[i] || accN[i] === 0) continue;
    grid.kind[i] = 1;
    const r = Math.round(accR[i] / accN[i]);
    const g = Math.round(accG[i] / accN[i]);
    const b = Math.round(accB[i] / accN[i]);
    grid.sourceRGB[i] = (r << 16) | (g << 8) | b;
    distance[i] = 0;
    queue[qt++] = i;
  }

  while (qh < qt) {
    const i = queue[qh++];
    const d = distance[i];
    if (d >= maxDistance) continue;
    const x = i % nx;
    const z = Math.floor(i / nx) % nz;
    const y = Math.floor(i / (nx * nz));
    for (const [dx, dy, dz] of NEIGHBORS_26) {
      const xx = x + dx;
      const yy = y + dy;
      const zz = z + dz;
      if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
      const j = xx + nx * (zz + nz * yy);
      if (distance[j] <= d + 1) continue;
      distance[j] = d + 1;
      grid.kind[j] = 1;
      if (grid.sourceRGB[j] < 0 && grid.sourceRGB[i] >= 0) grid.sourceRGB[j] = grid.sourceRGB[i];
      queue[qt++] = j;
    }
  }

  if (!hollow) fillEnclosedInterior(grid);
  return grid;
}

export function hollowSolidGrid(grid: VoxelGrid, thickness: number, repairThin: boolean): VoxelGrid {
  const t = repairThin ? Math.max(2, thickness) : thickness;
  const { nx, ny, nz } = grid;
  const n = grid.kind.length;
  const outside = new Uint8Array(n);
  const q: number[] = [];
  const tryPushEmpty = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    const i = x + nx * (z + nz * y);
    if (outside[i] || grid.kind[i]) return;
    outside[i] = 1;
    q.push(i);
  };

  for (let x = 0; x < nx; x++)
    for (let z = 0; z < nz; z++) {
      tryPushEmpty(x, 0, z);
      tryPushEmpty(x, ny - 1, z);
    }
  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++) {
      tryPushEmpty(0, y, z);
      tryPushEmpty(nx - 1, y, z);
    }
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      tryPushEmpty(x, y, 0);
      tryPushEmpty(x, y, nz - 1);
    }

  while (q.length) {
    const i = q.pop()!;
    const x = i % nx;
    const z = Math.floor(i / nx) % nz;
    const y = Math.floor(i / (nx * nz));
    tryPushEmpty(x + 1, y, z);
    tryPushEmpty(x - 1, y, z);
    tryPushEmpty(x, y + 1, z);
    tryPushEmpty(x, y - 1, z);
    tryPushEmpty(x, y, z + 1);
    tryPushEmpty(x, y, z - 1);
  }

  // BFS inward from every solid cell touching exterior empty space.
  const depth = new Uint8Array(n).fill(255);
  const bfs = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const i = x + nx * (z + nz * y);
        if (!grid.kind[i]) continue;
        let touchesOutside = false;
        for (const [dx, dy, dz] of NEIGHBORS_26) {
          const xx = x + dx;
          const yy = y + dy;
          const zz = z + dz;
          if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) {
            touchesOutside = true;
            break;
          }
          const j = xx + nx * (zz + nz * yy);
          // Seed from both the exterior and any enclosed cavity surface. This
          // preserves inner wall/roof courses instead of treating them as core.
          if (!grid.kind[j]) {
            touchesOutside = true;
            break;
          }
        }
        if (touchesOutside) {
          depth[i] = 0;
          bfs[tail++] = i;
        }
      }
    }
  }

  while (head < tail) {
    const i = bfs[head++];
    if (depth[i] >= t - 1) continue;
    const x = i % nx;
    const z = Math.floor(i / nx) % nz;
    const y = Math.floor(i / (nx * nz));
    for (const [dx, dy, dz] of NEIGHBORS_26) {
      const xx = x + dx;
      const yy = y + dy;
      const zz = z + dz;
      if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
      const j = xx + nx * (zz + nz * yy);
      if (!grid.kind[j] || depth[j] <= depth[i] + 1) continue;
      depth[j] = depth[i] + 1;
      bfs[tail++] = j;
    }
  }

  for (let i = 0; i < n; i++) {
    if (grid.kind[i] && depth[i] === 255) grid.kind[i] = 0;
  }
  return grid;
}

export function resampleGrid(source: VoxelGrid, targetLongAxis: number): VoxelGrid {
  const longAxis = Math.max(source.nx, source.ny, source.nz);
  const scale = targetLongAxis / longAxis;
  if (Math.abs(scale - 1) < 0.02) return source;
  const nx = Math.max(8, Math.round(source.nx * scale));
  const ny = Math.max(8, Math.round(source.ny * scale));
  const nz = Math.max(8, Math.round(source.nz * scale));
  const out = createGrid(nx, ny, nz);

  for (let y = 0; y < ny; y++) {
    const sy = Math.min(source.ny - 1, Math.floor(y / scale));
    for (let z = 0; z < nz; z++) {
      const sz = Math.min(source.nz - 1, Math.floor(z / scale));
      for (let x = 0; x < nx; x++) {
        const sx = Math.min(source.nx - 1, Math.floor(x / scale));
        const si = sx + source.nx * (sz + source.nz * sy);
        const di = x + nx * (z + nz * y);
        if (source.kind[si]) {
          out.kind[di] = 1;
          out.sourceRGB[di] = source.sourceRGB[si];
        }
      }
    }
  }
  return out;
}

function fillEnclosedInterior(grid: VoxelGrid): void {
  const { nx, ny, nz } = grid;
  const outside = new Uint8Array(grid.kind.length);
  const q: number[] = [];
  const push = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    const i = x + nx * (z + nz * y);
    if (outside[i] || grid.kind[i]) return;
    outside[i] = 1;
    q.push(i);
  };
  for (let x = 0; x < nx; x++)
    for (let z = 0; z < nz; z++) {
      push(x, 0, z);
      push(x, ny - 1, z);
    }
  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++) {
      push(0, y, z);
      push(nx - 1, y, z);
    }
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      push(x, y, 0);
      push(x, y, nz - 1);
    }
  while (q.length) {
    const i = q.pop()!;
    const x = i % nx;
    const z = Math.floor(i / nx) % nz;
    const y = Math.floor(i / (nx * nz));
    push(x + 1, y, z);
    push(x - 1, y, z);
    push(x, y + 1, z);
    push(x, y - 1, z);
    push(x, y, z + 1);
    push(x, y, z - 1);
  }
  for (let i = 0; i < grid.kind.length; i++) {
    if (!grid.kind[i] && !outside[i]) grid.kind[i] = 1;
  }
}
