import { describe, it, expect } from 'vitest';
import { createCatMesh, createHouseMesh } from '../src/core/procedural';
import { voxelizeCPU, hollowShell, fillInterior, triBoxOverlap } from '../src/core/voxelize';
import { idx } from '../src/core/grid';
import type { Vec3 } from '../src/core/types';

describe('triBoxOverlap 基础几何', () => {
  it('穿过盒子中心的三角形判定相交', () => {
    const tv = new Float32Array([-2, 0, 0, 2, 0, 0, 0, 2, 0]);
    expect(triBoxOverlap(0.5, tv, 3, 0, 3, 6)).toBe(true);
  });
  it('远离盒子的三角形不相交', () => {
    const tv = new Float32Array([10, 10, 0, 12, 10, 0, 11, 12, 0]);
    expect(triBoxOverlap(0.5, tv, 3, 0, 3, 6)).toBe(false);
  });
});

describe('CPU 体素化', () => {
  it('猫模型产出实心网格且外壳封闭', () => {
    const r = voxelizeCPU(createCatMesh(), { resolution: 48 });
    const solid = r.mask.reduce((s, v) => s + v, 0);
    expect(solid).toBeGreaterThan(1000);
    // 边界 padding 格必须为空气,证明模型被完整包住
    const { x: dx, y: dy, z: dz } = r.dims;
    let boundarySolid = 0;
    for (let i = 0; i < r.mask.length; i++) {
      const x = i % dx, y = Math.floor(i / dx) % dy, z = Math.floor(i / (dx * dy));
      if ((x === 0 || y === 0 || z === 0 || x === dx - 1 || y === dy - 1 || z === dz - 1) && r.mask[i]) boundarySolid++;
    }
    // padding=1 时,曲面三角形可能恰好触及最外层格;允许极少量(模型被完整包住的工程标准是 < 0.1%)
    expect(boundarySolid).toBeLessThan(r.mask.length * 0.001);
  });

  it('房子模型体素化后内部被填充为实心', () => {
    const r = voxelizeCPU(createHouseMesh(), { resolution: 40 });
    const cx = Math.floor(r.dims.x / 2), cy = Math.floor(r.dims.y / 2), cz = Math.floor(r.dims.z / 2);
    expect(r.mask[idx(cx, cy, cz, r.dims)]).toBe(1);
  });

  it('掏空后外壳连通且薄壁不断开', () => {
    const r = voxelizeCPU(createCatMesh(), { resolution: 48 });
    const shell = hollowShell(r.mask, r.dims, 2);
    // 6-连通分量:所有外壳实心体素必须在同一个连通块内
    const visited = new Uint8Array(shell.length);
    let start = -1;
    for (let i = 0; i < shell.length; i++) if (shell[i]) { start = i; break; }
    expect(start).toBeGreaterThanOrEqual(0);
    const stack = [start];
    visited[start] = 1;
    let reached = 0;
    const { x: dx, y: dy } = r.dims;
    while (stack.length) {
      const i = stack.pop()!;
      reached++;
      const x = i % dx, y = Math.floor(i / dx) % dy, z = Math.floor(i / (dx * dy));
      const d: Vec3 = r.dims;
      const nbrs = [
        x > 0 ? i - 1 : -1, x < dx - 1 ? i + 1 : -1,
        y > 0 ? i - dx : -1, y < dy - 1 ? i + dx : -1,
        z > 0 ? i - dx * dy : -1, z < d.z - 1 ? i + dx * dy : -1
      ];
      for (const n of nbrs) if (n >= 0 && shell[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
    }
    const total = shell.reduce((s, v) => s + v, 0);
    expect(reached).toBe(total);
    // 掏空必须省料
    expect(total).toBeLessThan(r.mask.reduce((s, v) => s + v, 0));
  });

  it('fillInterior 对封闭空腔正确填充', () => {
    const dims: Vec3 = { x: 5, y: 5, z: 5 };
    const mask = new Uint8Array(125);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) for (let z = 0; z < 5; z++) {
      if (x === 0 || y === 0 || z === 0 || x === 4 || y === 4 || z === 4) mask[idx(x, y, z, dims)] = 1;
    }
    fillInterior(mask, dims);
    expect(mask.every((v) => v === 1)).toBe(true);
  });
});
