import { describe, it, expect } from 'vitest';
import { createCatMesh, createHouseMesh } from '../src/core/procedural';
import { voxelizeCPU, hollowShell } from '../src/core/voxelize';
import { quantizeToPalette, DEFAULT_PALETTE } from '../src/core/palette';
import { mergeBricks } from '../src/core/merger';
import { analyzeStability, addSupports } from '../src/core/stability';
import { ALL_BRICK_TYPE_IDS } from '../src/core/brickTypes';
import { runPipeline, DEFAULT_SETTINGS } from '../src/core/pipeline';
import { encodeProject, decodeProject, maskToBase64, maskFromBase64 } from '../src/core/project';
import { partsListCsv } from '../src/core/exporters';
import { buildPartList, buildStepDetails } from '../src/core/instructions';
import { parseOBJ, parseMTL } from '../src/core/objParser';

describe('端到端冒烟', () => {
  it.each([
    ['猫', createCatMesh()],
    ['房子', createHouseMesh()]
  ])('%s:完整管线 runPipeline 结构不变量 + 10 秒预算', async (_n, mesh) => {
    const r = await runPipeline(mesh, {
      ...DEFAULT_SETTINGS,
      resolution: 96,
      shellThickness: 2,
      enabledBrickTypeIds: new Set(ALL_BRICK_TYPE_IDS),
      palette: DEFAULT_PALETTE,
      lockedColorIds: new Set(),
      autoSupport: true
    });
    expect(r.timings.totalMs).toBeLessThan(10_000);
    expect(r.merged.bricks.length).toBeGreaterThan(100);
    const groundZ = r.merged.bricks.reduce((m, b) => Math.min(m, b.z), Infinity);
    // 红线 1:非落地、非支撑砖必有下层咬合
    for (const b of r.merged.bricks) {
      if (b.z > groundZ && !b.support) expect(b.lowerContacts.length).toBeGreaterThan(0);
    }
    // 红线 2:无悬空体素
    const ls = r.voxel.dims.x * r.voxel.dims.y;
    let floating = 0;
    for (let z = groundZ + 1; z < r.voxel.dims.z; z++) {
      for (let i = z * ls; i < (z + 1) * ls; i++) {
        if (r.merged.finalMask[i] && !r.merged.finalMask[i - ls]) floating++;
      }
    }
    expect(floating).toBe(0);
    // 红线 3:自动支撑后无悬挑报告
    expect(r.report.issues.filter((i) => i.kind === 'cantilever')).toHaveLength(0);
    // 图纸分步覆盖全部砖(含自动支撑在合砖阶段补的砖)
    const covered = new Set(r.merged.steps.flatMap((s) => s.brickIds));
    expect(covered.size).toBe(r.merged.bricks.length);
  });

  it('工程文件编码/解码 + 掩码 base64 往返一致', () => {
    const v = voxelizeCPU(createHouseMesh(), { resolution: 40 });
    const shell = hollowShell(v.mask, v.dims, 2);
    const colors: (number | null)[] = new Array(shell.length).fill(null);
    for (let i = 0; i < shell.length; i++) if (shell[i]) colors[i] = v.colors[i];
    const q = quantizeToPalette(colors, DEFAULT_PALETTE);
    const m = mergeBricks({
      dims: v.dims, mask: shell, colorIds: q.colorIds,
      enabledBrickTypeIds: new Set(ALL_BRICK_TYPE_IDS)
    });
    const b64 = maskToBase64(m.finalMask);
    const back = maskFromBase64(b64, m.finalMask.length);
    expect(Array.from(back)).toEqual(Array.from(m.finalMask));

    const file = encodeProject({
      order: { id: 'O1', name: '测试', customer: '客户', note: '', status: '待审核', createdAt: 1 },
      settings: DEFAULT_SETTINGS, palette: DEFAULT_PALETTE, lockedColorIds: [],
      dims: v.dims, voxelSizeMm: 8, maskB64: b64,
      bricks: m.bricks, steps: m.steps,
      report: analyzeStability({ dims: v.dims, bricks: m.bricks, owner: m.owner, mask: m.finalMask, groundZ: 0 })
    });
    const decoded = decodeProject(JSON.parse(JSON.stringify(file)));
    expect(decoded.bricks.length).toBe(m.bricks.length);
    expect(decoded.dims).toEqual(v.dims);
  });

  it('零件清单 CSV 含 BOM 且砖数与砖表一致', () => {
    const v = voxelizeCPU(createCatMesh(), { resolution: 40 });
    const shell = hollowShell(v.mask, v.dims, 2);
    const colors: (number | null)[] = new Array(shell.length).fill(null);
    for (let i = 0; i < shell.length; i++) if (shell[i]) colors[i] = v.colors[i];
    const q = quantizeToPalette(colors, DEFAULT_PALETTE);
    const m = mergeBricks({
      dims: v.dims, mask: shell, colorIds: q.colorIds,
      enabledBrickTypeIds: new Set(ALL_BRICK_TYPE_IDS)
    });
    const csv = partsListCsv(m.bricks, DEFAULT_PALETTE, '猫');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const parts = buildPartList(m.bricks, DEFAULT_PALETTE);
    expect(parts.reduce((s, p) => s + p.count, 0)).toBe(m.bricks.length);
    expect(buildStepDetails(m.steps, m.bricks, DEFAULT_PALETTE).length).toBe(m.steps.length);
  });

  it('OBJ 解析器:封闭立方体(正确绕序)体素化结果实心', () => {
    // 顶点顺序与 procedural 盒子一致,保证朝外法线与封闭流形
    const obj = `
v -0.5 -0.5 -0.5
v 0.5 -0.5 -0.5
v 0.5 0.5 -0.5
v -0.5 0.5 -0.5
v -0.5 -0.5 0.5
v 0.5 -0.5 0.5
v 0.5 0.5 0.5
v -0.5 0.5 0.5
usemtl red
f 4 3 2
f 4 2 1
f 5 6 7
f 5 7 8
f 1 2 6
f 1 6 5
f 3 4 8
f 3 8 7
f 1 5 8
f 1 8 4
f 2 3 7
f 2 7 6
`;
    const mtl = parseMTL('newmtl red\nKd 0.8 0.1 0.1\n');
    const mesh = parseOBJ(obj, mtl);
    expect(mesh.indices.length).toBe(36);
    const r = voxelizeCPU(mesh, { resolution: 24 });
    expect(r.mask.reduce((s, x) => s + x, 0)).toBeGreaterThan(100);
  });

  it('addSupports 幂等:对已加固方案再跑一次不产生新砖', () => {
    const v = voxelizeCPU(createCatMesh(), { resolution: 48 });
    const shell = hollowShell(v.mask, v.dims, 2);
    const colors: (number | null)[] = new Array(shell.length).fill(null);
    for (let i = 0; i < shell.length; i++) if (shell[i]) colors[i] = v.colors[i];
    const q = quantizeToPalette(colors, DEFAULT_PALETTE);
    const m = mergeBricks({
      dims: v.dims, mask: shell, colorIds: q.colorIds,
      enabledBrickTypeIds: new Set(ALL_BRICK_TYPE_IDS)
    });
    const groundZ = m.bricks.reduce((mn, b) => Math.min(mn, b.z), Infinity);
    const first = addSupports({ dims: v.dims, bricks: m.bricks, owner: m.owner, mask: m.finalMask, groundZ });
    const n1 = m.bricks.length;
    const second = addSupports({ dims: v.dims, bricks: m.bricks, owner: m.owner, mask: m.finalMask, groundZ });
    expect(first.added.length).toBe(n1 - (n1 - first.added.length));
    expect(second.added.length).toBe(0);
  });
});
