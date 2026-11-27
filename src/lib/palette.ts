import type { BrickType, PaletteColor } from '../types';

export const BRICK_TYPES: BrickType[] = [
  { id: 'b11', name: '1×1 砖', w: 1, d: 1, height: 1.2, partNo: '3005' },
  { id: 'b12', name: '1×2 砖', w: 1, d: 2, height: 1.2, partNo: '3004' },
  { id: 'b13', name: '1×3 砖', w: 1, d: 3, height: 1.2, partNo: '3622' },
  { id: 'b14', name: '1×4 砖', w: 1, d: 4, height: 1.2, partNo: '3010' },
  { id: 'b22', name: '2×2 砖', w: 2, d: 2, height: 1.2, partNo: '3003' },
  { id: 'b23', name: '2×3 砖', w: 2, d: 3, height: 1.2, partNo: '3002' },
  { id: 'b24', name: '2×4 砖', w: 2, d: 4, height: 1.2, partNo: '3001' },
];

export const BRICK_TYPE_MAP: Record<string, BrickType> = Object.fromEntries(
  BRICK_TYPES.map((t) => [t.id, t]),
);

export const SUPPORT_COLOR: PaletteColor = {
  id: 'support-orange',
  name: '临时支撑橙',
  hex: '#ff7a1a',
  inStock: true,
  group: 'special',
};

export const PALETTE: PaletteColor[] = [
  { id: 'white', name: '颗粒白', hex: '#f4f4ee', inStock: true, group: 'neutral' },
  { id: 'light-gray', name: '浅灰', hex: '#a3a2a4', inStock: true, group: 'neutral' },
  { id: 'dark-gray', name: '深灰', hex: '#6b6e68', inStock: true, group: 'neutral' },
  { id: 'black', name: '黑色', hex: '#1b2a34', inStock: true, group: 'neutral' },

  { id: 'red', name: '经典红', hex: '#c91a09', inStock: true, group: 'bright' },
  { id: 'dark-red', name: '暗红', hex: '#720e0f', inStock: true, group: 'earth' },
  { id: 'coral', name: '珊瑚橙', hex: '#ff6f5e', inStock: false, group: 'bright' },
  { id: 'orange', name: '亮橙', hex: '#fe8a18', inStock: true, group: 'bright' },
  { id: 'yellow', name: '明黄', hex: '#f2cd37', inStock: true, group: 'bright' },
  { id: 'light-yellow', name: '浅米黄', hex: '#f7d9a0', inStock: true, group: 'neutral' },

  { id: 'green', name: '积木绿', hex: '#237841', inStock: true, group: 'bright' },
  { id: 'dark-green', name: '深绿', hex: '#184632', inStock: true, group: 'earth' },
  { id: 'lime', name: '青柠绿', hex: '#a5ca18', inStock: false, group: 'bright' },
  { id: 'sand-green', name: '沙绿', hex: '#a0bcac', inStock: true, group: 'earth' },

  { id: 'blue', name: '经典蓝', hex: '#0055bf', inStock: true, group: 'bright' },
  { id: 'dark-blue', name: '深蓝', hex: '#0a3463', inStock: true, group: 'earth' },
  { id: 'light-blue', name: '浅蓝', hex: '#b4d2e3', inStock: true, group: 'bright' },
  { id: 'sand-blue', name: '沙蓝', hex: '#6074a1', inStock: false, group: 'earth' },
  { id: 'purple', name: '紫色', hex: '#81007b', inStock: true, group: 'bright' },
  { id: 'pink', name: '粉色', hex: '#ffc8d8', inStock: true, group: 'bright' },

  { id: 'brown', name: '棕色', hex: '#582a12', inStock: true, group: 'earth' },
  { id: 'reddish-brown', name: '红棕', hex: '#7c3f1e', inStock: true, group: 'earth' },
  { id: 'dark-tan', name: '深棕褐', hex: '#958a73', inStock: true, group: 'earth' },
  { id: 'tan', name: '米色', hex: '#e4cd9e', inStock: true, group: 'earth' },
  { id: 'nougat', name: '肤橘', hex: '#d09168', inStock: true, group: 'earth' },

  { id: 'silver', name: '金属银灰', hex: '#8c9499', inStock: false, group: 'special' },
  { id: 'gold', name: '金属金', hex: '#aa7f2e', inStock: true, group: 'special' },
];

export const PALETTE_WITH_SUPPORT = [...PALETTE, SUPPORT_COLOR];

export const PALETTE_MAP: Record<string, PaletteColor> = Object.fromEntries(
  PALETTE_WITH_SUPPORT.map((c) => [c.id, c]),
);

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function packRgb(r: number, g: number, b: number): number {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

export function unpackRgb(value: number): [number, number, number] {
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** CIE Lab distance gives better brick color matching than raw RGB. */
export function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const [ar, ag, ab] = a.map(srgbToLinear) as [number, number, number];
  const [br, bg, bb] = b.map(srgbToLinear) as [number, number, number];

  const ax = ar * 0.4124 + ag * 0.3576 + ab * 0.1805;
  const ay = ar * 0.2126 + ag * 0.7152 + ab * 0.0722;
  const az = ar * 0.0193 + ag * 0.1192 + ab * 0.9505;
  const bx = br * 0.4124 + bg * 0.3576 + bb * 0.1805;
  const by = br * 0.2126 + bg * 0.7152 + bb * 0.0722;
  const bz = br * 0.0193 + bg * 0.1192 + bb * 0.9505;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [afx, afy, afz] = [f(ax / 0.95047), f(ay), f(az / 1.08883)];
  const [bfx, bfy, bfz] = [f(bx / 0.95047), f(by), f(bz / 1.08883)];
  const la = 116 * afy - 16;
  const aa = 500 * (afx - afy);
  const ba = 200 * (afy - afz);
  const lb = 116 * bfy - 16;
  const bb2 = 500 * (bfx - bfy);
  const bc = 200 * (bfy - bfz);
  return (la - lb) ** 2 + (aa - bb2) ** 2 + (ba - bc) ** 2;
}

export function nearestPaletteColor(
  rgb: [number, number, number],
  options: { includeOutOfStock?: boolean; lockedOnly?: Set<string> } = {},
): PaletteColor {
  const candidates = PALETTE.filter((c) => {
    if (c.id === SUPPORT_COLOR.id) return false;
    if (options.lockedOnly && options.lockedOnly.size > 0) return options.lockedOnly.has(c.id);
    if (!options.includeOutOfStock && !c.inStock) return false;
    return true;
  });
  let best = candidates[0] ?? PALETTE[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = colorDistance(rgb, hexToRgb(c.hex));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
