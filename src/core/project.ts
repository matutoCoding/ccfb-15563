import type { Brick, BuildStep, PaletteColor, ProjectSettings, StabilityReport, Vec3 } from './types';

/** 工程文件:订单元数据 + 完整转换结果,可导出为 .bfproj 重新导入 */
export interface ProjectFile {
  format: 'brickforge-project';
  version: 1;
  exportedAt: string;
  order: {
    id: string;
    name: string;
    customer: string;
    note: string;
    status: string;
    createdAt: number;
  };
  settings: ProjectSettings;
  palette: PaletteColor[];
  lockedColorIds: string[];
  dims: Vec3;
  voxelSizeMm: number;
  /** 实心体素掩码(0/1),base64 压缩传输 */
  maskB64: string;
  bricks: Brick[];
  steps: BuildStep[];
  report: StabilityReport;
  timings?: Record<string, number>;
}

export function encodeProject(data: Omit<ProjectFile, 'format' | 'version' | 'exportedAt'>): ProjectFile {
  return {
    format: 'brickforge-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    ...data
  };
}

export function decodeProject(json: unknown): ProjectFile {
  const p = json as ProjectFile;
  if (!p || p.format !== 'brickforge-project') {
    throw new Error('不是有效的 BrickForge 工程文件');
  }
  if (p.version !== 1) throw new Error(`不支持的工程版本: ${p.version}`);
  return p;
}

export function maskToBase64(mask: Uint8Array): string {
  // 每 8 个体素压成 1 字节
  const bytes = new Uint8Array(Math.ceil(mask.length / 8));
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) bytes[i >> 3] |= 1 << (i & 7);
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function maskFromBase64(b64: string, length: number): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const mask = new Uint8Array(length);
  for (let i = 0; i < length; i++) mask[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return mask;
}
