import { runPipeline } from '../core/pipeline';
import { maskToBase64 } from '../core/project';
import { createGpuVoxelizer, type GpuVoxelizer } from '../gpu/gpuVoxelizer';
import { useStore } from '../state/store';
import type { Order, OrderResult } from '../order';
import type { TriangleMesh } from '../core/mesh';

let gpuVoxelizer: GpuVoxelizer | null | undefined;

async function getGpu() {
  if (gpuVoxelizer === undefined) gpuVoxelizer = await createGpuVoxelizer();
  return gpuVoxelizer;
}

/** 跑完整转换管线并落库 */
export async function convertMesh(
  orderId: string,
  mesh: TriangleMesh,
  source: NonNullable<Order['source']>
) {
  const { settings, palette, lockedColorIds, saveResult, setBusy } = useStore.getState();
  setBusy('正在转换模型…');
  try {
    const gpu = await getGpu();
    const result = await runPipeline(mesh, {
      resolution: settings.targetResolution,
      shellThickness: settings.shellThickness,
      enabledBrickTypeIds: new Set(settings.enabledBrickTypes),
      palette,
      lockedColorIds,
      autoSupport: settings.autoSupport,
      voxelSizeMm: settings.voxelSizeMm,
      gpuVoxelize: gpu ? (m, r) => gpu.voxelize(m, r) : undefined
    });
    const solidVoxels = result.merged.finalMask.reduce((s, v) => s + v, 0);
    const orderResult: OrderResult = {
      dims: result.voxel.dims,
      voxelSizeMm: settings.voxelSizeMm,
      maskB64: maskToBase64(result.merged.finalMask),
      maskLength: result.merged.finalMask.length,
      bricks: result.merged.bricks,
      steps: result.merged.steps,
      report: result.report,
      palette,
      lockedColorIds: [...lockedColorIds],
      settings: { ...settings },
      solidVoxels,
      timings: result.timings as unknown as Record<string, number>
    };
    await saveResult(orderId, orderResult, source);
    return result;
  } finally {
    setBusy(null);
  }
}
