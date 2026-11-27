import type { Vec3, VoxelIndex, VoxelModel } from './types';

export const idx = (x: number, y: number, z: number, d: Vec3): VoxelIndex =>
  x + d.x * (y + d.y * z);

export const xyz = (i: VoxelIndex, d: Vec3): Vec3 => {
  const x = i % d.x;
  const y = Math.floor(i / d.x) % d.y;
  const z = Math.floor(i / (d.x * d.y));
  return { x, y, z };
};

export const inside = (x: number, y: number, z: number, d: Vec3): boolean =>
  x >= 0 && y >= 0 && z >= 0 && x < d.x && y < d.y && z < d.z;

export function isSolid(model: VoxelModel, i: VoxelIndex): boolean {
  return model.colors[i] !== null;
}

/** 6 邻接方向 */
export const NEIGHBORS6: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];

/** 统计实心体素数 */
export function countSolid(model: VoxelModel): number {
  let n = 0;
  for (const c of model.colors) if (c !== null) n++;
  return n;
}

/** 生成一个空的实心标记数组 */
export function emptyMask(dims: Vec3): Uint8Array {
  return new Uint8Array(dims.x * dims.y * dims.z);
}

/** 按物理体素尺寸换算成品尺寸(mm) */
export function physicalSizeMm(model: VoxelModel): Vec3 {
  return {
    x: model.dims.x * model.voxelSizeMm,
    y: model.dims.y * model.voxelSizeMm,
    z: model.dims.z * model.voxelSizeMm
  };
}

export function rgba(r: number, g: number, b: number, a = 255): number {
  return ((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

export const r8 = (c: number) => c & 255;
export const g8 = (c: number) => (c >> 8) & 255;
export const b8 = (c: number) => (c >> 16) & 255;

export function colorDistanceSq(a: number, b: number): number {
  const dr = r8(a) - r8(b);
  const dg = g8(a) - g8(b);
  const db = b8(a) - b8(b);
  return dr * dr + dg * dg + db * db;
}
