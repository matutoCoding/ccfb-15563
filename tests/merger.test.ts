import { describe, it, expect } from 'vitest';
import { createCatMesh, createHouseMesh } from '../src/core/procedural';
import { voxelizeCPU, hollowShell } from '../src/core/voxelize';
import { quantizeToPalette, DEFAULT_PALETTE, SUPPORT_COLOR_ID } from '../src/core/palette';
import { mergeBricks } from '../src/core/merger';
import { analyzeStability, addSupports } from '../src/core/stability';
import { idx } from '../src/core/grid';
import { ALL_BRICK_TYPE_IDS } from '../src/core/brickTypes';
import type { TriangleMesh } from '../src/core/mesh';

function buildFixture(mesh: TriangleMesh, resolution = 48, shell = 2) {
  const v = voxelizeCPU(mesh, { resolution });
  const mask = hollowShell(v.mask, v.dims, shell);
  const colors: (number | null)[] = new Array(mask.length).fill(null);
  for (let i = 0; i < mask.length; i++) if (mask[i]) colors[i] = v.colors[i];
  const quant = quantizeToPalette(colors, DEFAULT_PALETTE);
  const merged = mergeBricks({
    dims: v.dims, mask, colorIds: quant.colorIds,
    enabledBrickTypeIds: new Set(ALL_BRICK_TYPE_IDS)
  });
  return { v, mask, quant, merged };
}

describe('合砖结构不变量', () => {
  it.each([
    ['猫', createCatMesh()],
    ['房子', createHouseMesh()]
  ])('%s:每块非落地砖至少咬合一块下层砖(悬挑由自动支撑补齐)', (_name, mesh) => {
    const { v, merged } = buildFixture(mesh);
    const groundZ = merged.bricks.reduce((m, b) => Math.min(m, b.z), Infinity);
    const layerSize = v.dims.x * v.dims.y;

    for (const b of merged.bricks) {
      if (b.z === groundZ) {
        expect(b.lowerContacts).toHaveLength(0);
      } else if (!b.support) {
        // 非支撑砖必须咬合至少一块下层砖;完全悬空的位置由支撑柱承担
        expect(b.lowerContacts.length, `砖 #${b.id} ${b.typeId} 无下层咬合`).toBeGreaterThan(0);
      }
    }
    // 原始外壳可能含悬挑(内腔顶):自动支撑补齐后,无悬空体素
    addSupports({
      dims: v.dims, bricks: merged.bricks, owner: merged.owner,
      mask: merged.finalMask, groundZ
    });
    let floating = 0;
    for (let z = groundZ + 1; z < v.dims.z; z++) {
      for (let i = z * layerSize; i < (z + 1) * layerSize; i++) {
        if (merged.finalMask[i] && !merged.finalMask[i - layerSize]) floating++;
      }
    }
    expect(floating).toBe(0);
  });

  it('层间交错:相邻两层不允许全部砖同轮廓整列对齐', () => {
    const { merged } = buildFixture(createHouseMesh(), 40);
    const layers = new Map<number, typeof merged.bricks>();
    for (const b of merged.bricks) {
      if (!layers.has(b.z)) layers.set(b.z, []);
      layers.get(b.z)!.push(b);
    }
    let alignedPairsTotal = 0, pairsTotal = 0;
    const zs = [...layers.keys()].sort((a, b) => a - b);
    for (let k = 1; k < zs.length; k++) {
      const upper = layers.get(zs[k])!;
      const lower = layers.get(zs[k - 1])!;
      for (const ub of upper) {
        pairsTotal++;
        if (lower.some((lb) => lb.x === ub.x && lb.y === ub.y && lb.nx === ub.nx && lb.ny === ub.ny)) {
          alignedPairsTotal++;
        }
      }
    }
    // 允许局部对齐,但整层完全对齐(>80%)判定失败
    expect(alignedPairsTotal / pairsTotal).toBeLessThan(0.8);
  });

  it('所有砖型尺寸合法且不越界、不重叠', () => {
    const { v, merged } = buildFixture(createCatMesh());
    const seen = new Set<number>();
    for (const b of merged.bricks) {
      expect(b.x + b.nx).toBeLessThanOrEqual(v.dims.x);
      expect(b.y + b.ny).toBeLessThanOrEqual(v.dims.y);
      for (let yy = 0; yy < b.ny; yy++) {
        for (let xx = 0; xx < b.nx; xx++) {
          const vi = idx(b.x + xx, b.y + yy, b.z, v.dims);
          expect(seen.has(vi), `体素被两块砖重复占用`).toBe(false);
          seen.add(vi);
          expect(merged.owner[vi]).toBe(b.id);
        }
      }
    }
  });

  it('稳定性分析:自动支撑后零悬空、零悬挑', () => {
    const { v, merged } = buildFixture(createCatMesh());
    const groundZ = merged.bricks.reduce((m, b) => Math.min(m, b.z), Infinity);
    const before = analyzeStability({
      dims: v.dims, bricks: merged.bricks, owner: merged.owner,
      mask: merged.finalMask, groundZ
    });
    expect(before.floatingCount).toBe(0); // 合砖器自身就该消除悬空
    const { report } = addSupports({
      dims: v.dims, bricks: merged.bricks, owner: merged.owner,
      mask: merged.finalMask, groundZ
    });
    expect(report.floatingCount).toBe(0);
    expect(report.issues.filter((i) => i.kind === 'cantilever')).toHaveLength(0);
  });

  it('支撑件使用专用色且计入独立标记', () => {
    const { merged } = buildFixture(createCatMesh());
    for (const b of merged.bricks.filter((x) => x.support)) {
      expect(b.colorId).toBe(SUPPORT_COLOR_ID);
      expect(b.typeId).toBe('B11');
    }
  });
});

describe('配色量化', () => {
  it('缺货色不会出现在量化结果中,自动换最近色', () => {
    const palette = DEFAULT_PALETTE.map((c) => c.id === 'P05' ? { ...c, outOfStock: true } : c);
    const colors = [0xff2028c4 /* 接近 P05 红 */, null, 0xffffffff];
    const r = quantizeToPalette(colors, palette);
    expect(r.colorIds).not.toContain('P05');
    expect(r.usage.has('P05')).toBe(false);
  });

  it('锁定色即使缺货也强制保留', () => {
    const palette = DEFAULT_PALETTE.map((c) => c.id === 'P05' ? { ...c, outOfStock: true } : c);
    const r = quantizeToPalette([0xff2028c4], palette, { lockedIds: new Set(['P05']) });
    expect(r.colorIds[0]).toBe('P05');
  });

  it('猫模型全部体素都能映射到色卡', () => {
    const { quant, mask } = buildFixture(createCatMesh());
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) expect(quant.colorIds[i]).not.toBeNull();
    }
  });
});
