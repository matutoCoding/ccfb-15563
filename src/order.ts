import type { Brick, BuildStep, ProjectSettings, StabilityReport, Vec3 } from './core/types';
import type { PaletteColor } from './core/types';

export type OrderStatus = '待处理' | '转换中' | '待审核' | '已确认' | '已归档';

export interface Order {
  id: string;
  name: string;
  customer: string;
  status: OrderStatus;
  note: string;
  createdAt: number;
  updatedAt: number;
  /** 原始模型来源信息 */
  source?: { kind: 'upload' | 'cat' | 'house'; fileName?: string };
  /** 转换结果(未转换时为空) */
  result?: OrderResult;
}

export interface OrderResult {
  dims: Vec3;
  voxelSizeMm: number;
  maskB64: string;
  maskLength: number;
  bricks: Brick[];
  steps: BuildStep[];
  report: StabilityReport;
  palette: PaletteColor[];
  lockedColorIds: string[];
  settings: ProjectSettings;
  solidVoxels: number;
  timings?: Record<string, number>;
}

export function uid(prefix = 'O'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
