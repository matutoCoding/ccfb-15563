import type { PaletteOverride, Project, VoxelGrid } from '../types';
import { PALETTE, SUPPORT_COLOR, hexToRgb, nearestPaletteColor, unpackRgb } from './palette';
import { gridIndexRaw } from './utils';

export interface QuantizeOptions {
  autoReplaceOutOfStock: boolean;
  overrides: Record<string, PaletteOverride>;
  /** Preserve voxel regions whose current color is locked. */
  preserveLocked?: boolean;
}

export function availableColorIds(overrides: Record<string, PaletteOverride>): Set<string> {
  return new Set(
    PALETTE.filter((c) => overrides[c.id]?.inStock ?? c.inStock).map((c) => c.id),
  );
}

export function isColorLocked(
  colorId: string,
  overrides: Record<string, PaletteOverride>,
): boolean {
  return overrides[colorId]?.locked ?? false;
}

export function effectiveInStock(
  colorId: string,
  overrides: Record<string, PaletteOverride>,
): boolean {
  const base = PALETTE.find((c) => c.id === colorId)?.inStock ?? colorId === SUPPORT_COLOR.id;
  return overrides[colorId]?.inStock ?? base;
}

function nearestAvailableIndex(
  rgb: [number, number, number],
  available: Set<string>,
): number {
  let best = 0;
  let bestD = Infinity;
  PALETTE.forEach((c, i) => {
    if (!available.has(c.id)) return;
    const target = hexToRgb(c.hex);
    // Fast weighted RGB is enough for stock substitution and keeps requant quick.
    const rmean = (rgb[0] + target[0]) / 2;
    const dr = rgb[0] - target[0];
    const dg = rgb[1] - target[1];
    const db = rgb[2] - target[2];
    const d = (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * Quantize source texture colors. Locked palette entries protect existing
 * regions; unlocked out-of-stock entries are remapped to nearest in-stock.
 */
export function quantizeGrid(grid: VoxelGrid, options: QuantizeOptions): {
  colorCounts: Map<string, number>;
  remapped: number;
} {
  const available = availableColorIds(options.overrides);
  const lockedIds = new Set(
    PALETTE.filter((c) => options.overrides[c.id]?.locked).map((c) => c.id),
  );
  const lockedIndices = new Set(
    PALETTE.map((c, i) => (lockedIds.has(c.id) ? i : -1)).filter((i) => i >= 0),
  );

  // Remember locked regions before overwriting the index buffer.
  const preserve = new Uint8Array(grid.color.length);
  if (options.preserveLocked) {
    for (let i = 0; i < grid.color.length; i++) {
      if (grid.kind[i] !== 0 && lockedIndices.has(grid.color[i])) preserve[i] = grid.color[i] + 1;
    }
  }

  const cache = new Map<number, number>();
  const colorCounts = new Map<string, number>();
  let remapped = 0;

  for (let y = 0; y < grid.ny; y++) {
    for (let z = 0; z < grid.nz; z++) {
      for (let x = 0; x < grid.nx; x++) {
        const i = gridIndexRaw(grid.nx, grid.nz, x, y, z);
        if (grid.kind[i] === 0) {
          grid.color[i] = 255;
          continue;
        }
        if (preserve[i]) {
          grid.color[i] = preserve[i] - 1;
          const id = PALETTE[grid.color[i]].id;
          colorCounts.set(id, (colorCounts.get(id) ?? 0) + 1);
          continue;
        }

        const src = grid.sourceRGB[i];
        let idx: number;
        if (src < 0) {
          idx = 0;
        } else if (cache.has(src)) {
          idx = cache.get(src)!;
        } else {
          const rgb = unpackRgb(src);
          // If the user has explicitly locked a small palette, match within it.
          const match = nearestPaletteColor(
            rgb,
            lockedIds.size > 0 ? { lockedOnly: lockedIds } : { includeOutOfStock: true },
          );
          idx = PALETTE.findIndex((c) => c.id === match.id);
          cache.set(src, idx);
        }

        const colorId = PALETTE[idx]?.id ?? PALETTE[0].id;
        const locked = isColorLocked(colorId, options.overrides);
        if (
          options.autoReplaceOutOfStock &&
          !locked &&
          !available.has(colorId)
        ) {
          idx = nearestAvailableIndex(unpackRgb(src < 0 ? 0xcccccc : src), available);
          remapped++;
        }

        grid.color[i] = idx;
        const finalId = PALETTE[idx].id;
        colorCounts.set(finalId, (colorCounts.get(finalId) ?? 0) + 1);
      }
    }
  }

  return { colorCounts, remapped };
}

/** Recompute brick colors after stock/lock changes without a full re-voxelize. */
export function recolorBricksFromGrid(project: Project): void {
  if (!project.grid) return;
  for (const b of project.bricks) {
    if (b.support) {
      b.colorId = SUPPORT_COLOR.id;
      continue;
    }
    const [x, y, z] = [b.x, b.y, b.z];
    const i = gridIndexRaw(project.grid.nx, project.grid.nz, x, y, z);
    const idx = project.grid.color[i];
    b.colorId = idx < PALETTE.length ? PALETTE[idx].id : 'light-gray';
  }
}
