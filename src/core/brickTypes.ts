import type { BrickType } from './types';

/** 系统支持的真实砖型(高度均为 1 层,旋转在放置时生成) */
export const BRICK_TYPES: BrickType[] = [
  { id: 'B11', nx: 1, ny: 1, name: '1x1' },
  { id: 'B12', nx: 1, ny: 2, name: '1x2' },
  { id: 'B13', nx: 1, ny: 3, name: '1x3' },
  { id: 'B14', nx: 1, ny: 4, name: '1x4' },
  { id: 'B22', nx: 2, ny: 2, name: '2x2' },
  { id: 'B23', nx: 2, ny: 3, name: '2x3' },
  { id: 'B24', nx: 2, ny: 4, name: '2x4' }
];

export const ALL_BRICK_TYPE_IDS = BRICK_TYPES.map((t) => t.id);

/** 允许的朝向(底面旋转 90°),正方形砖去重 */
export interface OrientedType {
  typeId: string;
  nx: number;
  ny: number;
}

export function orientationsFor(enabledIds: ReadonlySet<string>): OrientedType[] {
  const out: OrientedType[] = [];
  const seen = new Set<string>();
  for (const t of BRICK_TYPES) {
    if (!enabledIds.has(t.id)) continue;
    const rot = (nx: number, ny: number) => {
      const key = `${nx}x${ny}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ typeId: t.id, nx, ny });
    };
    rot(t.nx, t.ny);
    rot(t.ny, t.nx);
  }
  // 大砖优先,减少零件数
  return out.sort((a, b) => b.nx * b.ny - a.nx * a.ny);
}
