import { hollowShell, voxelizeCPU, type VoxelizeResult } from './voxelize';
import { quantizeToPalette, type QuantizeResult } from './palette';
import { mergeBricks, type MergeResult } from './merger';
import { analyzeStability, addSupports } from './stability';
import type { PaletteColor, ProjectSettings, StabilityReport, Vec3, VoxelModel } from './types';

export interface PipelineStageTiming {
  voxelizeMs: number;
  hollowMs: number;
  quantizeMs: number;
  mergeMs: number;
  stabilityMs: number;
  supportMs: number;
  totalMs: number;
}

export interface PipelineResult {
  voxel: VoxelizeResult;
  hollowMask: Uint8Array;
  quant: QuantizeResult;
  merged: MergeResult;
  report: StabilityReport;
  model: VoxelModel;
  timings: PipelineStageTiming;
}

export interface PipelineOptions {
  resolution: number;
  shellThickness: number;
  enabledBrickTypeIds: ReadonlySet<string>;
  palette: PaletteColor[];
  lockedColorIds?: ReadonlySet<string>;
  autoSupport: boolean;
  voxelSizeMm: number;
  /** GPU 路径注入:WebGPU 体素化实现,缺省走 CPU */
  gpuVoxelize?: (mesh: import('./mesh').TriangleMesh, resolution: number) => Promise<VoxelizeResult | null>;
}

/** 全流程:体素化 → 掏空 → 配色 → 合砖 → 稳定性 → (可选)自动支撑 */
export async function runPipeline(
  mesh: import('./mesh').TriangleMesh,
  opts: PipelineOptions
): Promise<PipelineResult> {
  const t0 = performance.now();

  const tv0 = performance.now();
  let voxel: VoxelizeResult | null = null;
  if (opts.gpuVoxelize) voxel = await opts.gpuVoxelize(mesh, opts.resolution);
  if (!voxel) voxel = voxelizeCPU(mesh, { resolution: opts.resolution });
  const voxelizeMs = performance.now() - tv0;

  const th0 = performance.now();
  const hollowMask = hollowShell(voxel.mask, voxel.dims, Math.max(1, opts.shellThickness));
  const hollowMs = performance.now() - th0;

  const tq0 = performance.now();
  const voxelColors: (number | null)[] = new Array(hollowMask.length).fill(null);
  for (let i = 0; i < hollowMask.length; i++) {
    if (hollowMask[i]) voxelColors[i] = voxel.colors[i] ?? 0xff888888;
  }
  const quant = quantizeToPalette(voxelColors, opts.palette, { lockedIds: opts.lockedColorIds });
  const quantizeMs = performance.now() - tq0;

  const tm0 = performance.now();
  const merged = mergeBricks({
    dims: voxel.dims,
    mask: hollowMask,
    colorIds: quant.colorIds,
    enabledBrickTypeIds: opts.enabledBrickTypeIds
  });
  const mergeMs = performance.now() - tm0;

  const ts0 = performance.now();
  const groundZ = firstSolidLayer(merged.finalMask, voxel.dims);
  let report = analyzeStability({
    dims: voxel.dims,
    bricks: merged.bricks,
    owner: merged.owner,
    mask: merged.finalMask,
    groundZ
  });
  const stabilityMs = performance.now() - ts0;

  const tu0 = performance.now();
  if (opts.autoSupport && (report.floatingCount > 0 || report.issues.some((i) => i.kind === 'cantilever'))) {
    const fix = addSupports({
      dims: voxel.dims,
      bricks: merged.bricks,
      owner: merged.owner,
      mask: merged.finalMask,
      groundZ
    });
    merged.supportVoxels += fix.added.length;
    report = fix.report;
    // 支撑砖在合砖步骤生成后才加入,需要重建分步以覆盖全部砖
    merged.steps = rebuildSteps(merged.bricks, groundZ);
  }
  const supportMs = performance.now() - tu0;

  const model: VoxelModel = {
    dims: voxel.dims,
    colors: quant.colorIds.map((id) => (id === null ? null : packedRgb(id, opts.palette))),
    voxelSizeMm: opts.voxelSizeMm
  };

  return {
    voxel, hollowMask, quant, merged, report, model,
    timings: {
      voxelizeMs, hollowMs, quantizeMs, mergeMs, stabilityMs, supportMs,
      totalMs: performance.now() - t0
    }
  };
}

function firstSolidLayer(mask: Uint8Array, dims: Vec3): number {
  const layerSize = dims.x * dims.y;
  for (let z = 0; z < dims.z; z++) {
    for (let i = z * layerSize; i < (z + 1) * layerSize; i++) {
      if (mask[i]) return z;
    }
  }
  return 0;
}

function packedRgb(colorId: string, palette: PaletteColor[]): number {
  const c = palette.find((p) => p.id === colorId);
  if (!c) return 0xff808080;
  const [r, g, b] = c.rgb;
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

function rebuildSteps(bricks: import('./types').Brick[], groundZ: number): import('./types').BuildStep[] {
  const byLayer = new Map<number, number[]>();
  for (const b of bricks) {
    if (!byLayer.has(b.z)) byLayer.set(b.z, []);
    byLayer.get(b.z)!.push(b.id);
  }
  const steps: import('./types').BuildStep[] = [];
  let index = 0;
  const maxZ = Math.max(...byLayer.keys());
  for (let z = groundZ; z <= maxZ; z++) {
    const ids = byLayer.get(z);
    if (!ids || !ids.length) continue;
    steps.push({ index: index++, layer: z, brickIds: ids });
  }
  return steps;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  voxelSizeMm: 8,
  shellThickness: 2,
  targetResolution: 64,
  enabledBrickTypes: ['B11', 'B12', 'B13', 'B14', 'B22', 'B23', 'B24'],
  autoSupport: true
};
