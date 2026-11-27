import type {
  BuildStats,
  ConvertSettings,
  LoadedModelSource,
  Project,
  VoxelGrid,
} from '../types';
import { createCatGrid, createHouseGrid } from './procedural';
import { quantizeGrid } from './color';
import { planBricks } from './planner';
import { finalizeShell, hollowSolidGrid, resampleGrid, voxelizeCpu } from './voxelizer';
import { voxelizeGpu, webgpuAvailable } from './gpuVoxelizer';
import { BRICK_TYPES } from './palette';

export function defaultSettings(): ConvertSettings {
  return {
    resolution: 64,
    hollow: true,
    shellThickness: 2,
    repairThin: true,
    allowedTypeIds: BRICK_TYPES.map((b) => b.id),
    autoSupport: true,
    reinforceSingleStuds: false,
    autoReplaceOutOfStock: true,
    staggerBonds: true,
  };
}

export function templateGrid(kind: 'cat' | 'house', resolution: number): VoxelGrid {
  const base = kind === 'cat' ? createCatGrid() : createHouseGrid();
  const grid = resampleGrid(base, resolution);
  hollowSolidGrid(grid, 2, true);
  return grid;
}

export interface ConversionResult {
  grid: VoxelGrid;
  bricks: Project['bricks'];
  issues: Project['issues'];
  partCounts: Project['partCounts'];
  stats: BuildStats;
}

export async function runConversion(
  project: Project,
  source: LoadedModelSource | null,
): Promise<ConversionResult> {
  const started = performance.now();
  const settings = project.settings;
  let grid: VoxelGrid;
  let gpuMs: number | undefined;
  let backend: boolean = webgpuAvailable();
  let sourceTriangles: number | undefined;
  let sourceMeshes: number | undefined;

  if (project.sourceKind === 'cat' || project.sourceKind === 'house') {
    grid = templateGrid(project.sourceKind, settings.resolution);
  } else if (source) {
    sourceTriangles = source.triangleCount;
    sourceMeshes = source.meshCount;
    let seeds;
    if (webgpuAvailable()) {
      try {
        seeds = await voxelizeGpu(source, settings.resolution);
        gpuMs = seeds.gpuMs;
      } catch (err) {
        console.warn('WebGPU 体素化失败，自动切换 CPU 保守体素化', err);
        seeds = voxelizeCpu(source, settings.resolution);
        backend = false;
      }
    } else {
      seeds = voxelizeCpu(source, settings.resolution);
      backend = false;
    }
    grid = finalizeShell(seeds, settings.shellThickness, settings.repairThin, settings.hollow);
  } else if (project.grid) {
    // Re-run color/brick planning after settings changes without source mesh.
    grid = project.grid;
  } else {
    grid = templateGrid('cat', settings.resolution);
  }

  const colorStart = performance.now();
  quantizeGrid(grid, {
    autoReplaceOutOfStock: settings.autoReplaceOutOfStock,
    overrides: project.paletteOverrides,
    preserveLocked: true,
  });
  const colorMs = performance.now() - colorStart;

  const mergeStart = performance.now();
  const plan = planBricks(grid, settings);
  const mergeMs = performance.now() - mergeStart;

  const materialVoxels = Array.from(grid.kind).filter((k) => k === 1).length;
  const supportBricks = plan.bricks.filter((b) => b.support).length;
  const layers = plan.bricks.reduce((m, b) => Math.max(m, b.y + 1), 0);
  const typeCount = new Set(plan.bricks.map((b) => b.typeId)).size;
  const colorCount = new Set(plan.bricks.map((b) => b.colorId)).size;

  const stats: BuildStats = {
    sourceTriangles,
    sourceMeshes,
    voxelCount: materialVoxels,
    shellVoxelCount: materialVoxels,
    supportVoxelCount: supportBricks,
    brickCount: plan.bricks.length,
    supportBrickCount: supportBricks,
    layerCount: layers,
    partTypeCount: typeCount,
    colorCount,
    floatingCount: plan.floatingCount,
    singleStudCount: plan.singleStudCount,
    gpuVoxelMs: gpuMs,
    colorMs,
    mergeMs,
    totalMs: performance.now() - started,
    webgpu: backend,
  };

  return {
    grid,
    bricks: plan.bricks,
    issues: plan.issues,
    partCounts: plan.partCounts,
    stats,
  };
}
