import { r8, g8, b8, rgba } from './grid';
import type { PaletteColor } from './types';

/** 支撑结构专用色(中性灰,零件清单单列) */
export const SUPPORT_COLOR_ID = 'S00';

/** 默认颗粒色卡:贴近实际积木色号,id 稳定,工程文件引用 id */
export const DEFAULT_PALETTE: PaletteColor[] = [
  { id: 'P01', name: '白色', rgb: [242, 243, 241] },
  { id: 'P02', name: '黑色', rgb: [27, 28, 30] },
  { id: 'P03', name: '深灰', rgb: [89, 93, 96] },
  { id: 'P04', name: '浅灰', rgb: [161, 165, 168] },
  { id: 'P05', name: '红色', rgb: [196, 40, 32] },
  { id: 'P06', name: '橙色', rgb: [218, 133, 46] },
  { id: 'P07', name: '黄色', rgb: [245, 205, 48] },
  { id: 'P08', name: '黄绿', rgb: [170, 202, 67] },
  { id: 'P09', name: '绿色', rgb: [58, 146, 75] },
  { id: 'P10', name: '深绿', rgb: [36, 90, 60] },
  { id: 'P11', name: '青色', rgb: [60, 162, 167] },
  { id: 'P12', name: '天蓝', rgb: [110, 175, 216] },
  { id: 'P13', name: '蓝色', rgb: [32, 88, 168] },
  { id: 'P14', name: '深蓝', rgb: [30, 50, 92] },
  { id: 'P15', name: '紫色', rgb: [118, 76, 146] },
  { id: 'P16', name: '粉色', rgb: [232, 146, 172] },
  { id: 'P17', name: '棕色', rgb: [105, 64, 42] },
  { id: 'P18', name: '米色', rgb: [214, 193, 154] },
  { id: 'P19', name: '肉色', rgb: [222, 174, 130] },
  { id: 'P20', name: '沙蓝', rgb: [138, 168, 184] },
  { id: SUPPORT_COLOR_ID, name: '支撑灰', rgb: [120, 124, 128] }
];

/** redmean 感知距离,比纯欧氏距离更贴近人眼 */
export function colorDistance(a: number, b: number): number {
  const ar = r8(a), ag = g8(a), ab = b8(a);
  const br = r8(b), bg = g8(b), bb = b8(b);
  const rm = (ar + br) / 2;
  const dr = ar - br, dg = ag - bg, db = ab - bb;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

export interface QuantizeOptions {
  /** 锁定的色卡 id:量化时保持这些颜色不被替换(即使缺货,锁定也优先) */
  lockedIds?: ReadonlySet<string>;
}

export interface QuantizeResult {
  /** 与输入等长的色卡 id 数组(空心位置为 null) */
  colorIds: (string | null)[];
  /** 实际用到的色卡 id → 颗粒数 */
  usage: Map<string, number>;
}

/**
 * 把任意 RGB 体素颜色量化到色卡:
 * - 缺货色自动跳过,换可用范围内最近色
 * - 锁定色即使缺货也强制保留(由 UI 给出冲突提示)
 */
export function quantizeToPalette(
  voxelColors: ReadonlyArray<number | null>,
  palette: ReadonlyArray<PaletteColor>,
  opts: QuantizeOptions = {}
): QuantizeResult {
  const locked = opts.lockedIds ?? new Set<string>();
  const usable = palette.filter((c) => !c.outOfStock || locked.has(c.id));
  const packed = usable.map((c) => rgba(c.rgb[0], c.rgb[1], c.rgb[2]));
  const cache = new Map<number, string>();
  const colorIds: (string | null)[] = new Array(voxelColors.length).fill(null);
  const usage = new Map<string, number>();

  for (let i = 0; i < voxelColors.length; i++) {
    const vc = voxelColors[i];
    if (vc === null) continue;
    let id = cache.get(vc);
    if (!id) {
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < packed.length; k++) {
        const d = colorDistance(vc, packed[k]);
        if (d < bestD) { bestD = d; best = k; }
      }
      id = usable[best].id;
      cache.set(vc, id);
    }
    colorIds[i] = id;
    usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  return { colorIds, usage };
}

/** 仅对缺货替换场景:把某个色卡 id 的体素重新映射到最近的可用色 */
export function nearestAvailableColor(
  targetId: string,
  palette: ReadonlyArray<PaletteColor>,
  lockedIds: ReadonlySet<string>
): string {
  const target = palette.find((c) => c.id === targetId);
  if (!target) return targetId;
  const targetPacked = rgba(target.rgb[0], target.rgb[1], target.rgb[2]);
  let best = '';
  let bestD = Infinity;
  for (const c of palette) {
    if (c.outOfStock && !lockedIds.has(c.id)) continue;
    if (c.id === targetId) continue;
    const d = colorDistance(targetPacked, rgba(c.rgb[0], c.rgb[1], c.rgb[2]));
    if (d < bestD) { bestD = d; best = c.id; }
  }
  return best || targetId;
}
