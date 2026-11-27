import { describe, it, expect } from 'vitest';
import { voxelizeCPU, hollowShell } from '../src/core/voxelize';
import { quantizeToPalette, DEFAULT_PALETTE } from '../src/core/palette';
import { mergeBricks } from '../src/core/merger';
import { ALL_BRICK_TYPE_IDS } from '../src/core/brickTypes';
import type { TriangleMesh } from '../src/core/mesh';

/** 大盒子:约 10 万实心体素的封闭模型,用于性能基线 */
function bigBoxMesh(_targetVoxels: number): TriangleMesh {
  const h = 0.5;
  // 立方体 12 个三角形
  const p: number[] = [];
  const corners = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]
  ];
  for (const c of corners) p.push(...c);
  const idx = [
    0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6,
    0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5
  ];
  return {
    positions: Float32Array.from(p),
    indices: Uint32Array.from(idx),
    vertexColors: Uint32Array.from(corners.map(() => 0xff8855cc)),
    baseColor: 0xff8855cc
  };
}

describe('性能基线(10 万体素 < 10 秒)', () => {
  it('体素化 + 掏空 + 配色 + 合砖 全流程耗时达标', () => {
    const mesh = bigBoxMesh(100_000);
    // 分辨率 58 + padding → 网格约 60³ ≈ 21.6 万格,实心体素约 10 万级别
    const t0 = performance.now();
    const v = voxelizeCPU(mesh, { resolution: 58 });
    const tVox = performance.now() - t0;
    const rawSolid = v.mask.reduce((s, x) => s + x, 0);
    expect(rawSolid).toBeGreaterThan(80_000);

    const t1 = performance.now();
    const shell = hollowShell(v.mask, v.dims, 2);
    const tHollow = performance.now() - t1;

    const solidCount = shell.reduce((s, x) => s + x, 0);
    expect(solidCount).toBeGreaterThan(10_000); // 掏空后外壳省料

    const colors: (number | null)[] = new Array(shell.length).fill(null);
    for (let i = 0; i < shell.length; i++) if (shell[i]) colors[i] = v.colors[i] ?? 0xff8855cc;

    const t2 = performance.now();
    const quant = quantizeToPalette(colors, DEFAULT_PALETTE);
    const tQuant = performance.now() - t2;

    const t3 = performance.now();
    const merged = mergeBricks({
      dims: v.dims, mask: shell, colorIds: quant.colorIds,
      enabledBrickTypeIds: new Set(ALL_BRICK_TYPE_IDS)
    });
    const tMerge = performance.now() - t3;

    const total = tVox + tHollow + tQuant + tMerge;
    console.log('perf(ms)', { tVox, tHollow, tQuant, tMerge, total, solidCount, bricks: merged.bricks.length });
    expect(total).toBeLessThan(10_000);
    expect(merged.bricks.length).toBeGreaterThan(0);
  });
});
