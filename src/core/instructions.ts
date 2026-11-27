import { BRICK_TYPES } from './brickTypes';
import type { PaletteColor, Brick, BuildStep } from './types';

export interface PartLine {
  typeId: string;
  typeName: string;
  colorId: string;
  colorName: string;
  rgb: [number, number, number];
  count: number;
  support: boolean;
}

/** 汇总零件清单:按砖型 × 颜色统计 */
export function buildPartList(bricks: Brick[], palette: PaletteColor[]): PartLine[] {
  const colorMap = new Map(palette.map((c) => [c.id, c]));
  const typeMap = new Map(BRICK_TYPES.map((t) => [t.id, t]));
  const agg = new Map<string, PartLine>();
  for (const b of bricks) {
    const key = `${b.typeId}|${b.colorId}`;
    const line = agg.get(key);
    if (line) { line.count++; continue; }
    const pc = colorMap.get(b.colorId);
    agg.set(key, {
      typeId: b.typeId,
      typeName: typeMap.get(b.typeId)?.name ?? b.typeId,
      colorId: b.colorId,
      colorName: pc?.name ?? b.colorId,
      rgb: pc?.rgb ?? [128, 128, 128],
      count: 1,
      support: !!b.support
    });
  }
  return [...agg.values()].sort((a, b) => b.count - a.count);
}

export interface StepDetail {
  step: BuildStep;
  parts: PartLine[];
  newBrickCount: number;
}

/** 每一步用到的零件(只计本步新放的砖) */
export function buildStepDetails(steps: BuildStep[], bricks: Brick[], palette: PaletteColor[]): StepDetail[] {
  const byId = new Map(bricks.map((b) => [b.id, b]));
  return steps.map((step) => {
    const stepBricks = step.brickIds.map((id) => byId.get(id)!).filter(Boolean);
    return {
      step,
      parts: buildPartList(stepBricks, palette),
      newBrickCount: stepBricks.length
    };
  });
}

/** 顶层总览:总砖数、层数、颜色数、预计搭建步数 */
export function buildSummary(bricks: Brick[], steps: BuildStep[]) {
  const colors = new Set(bricks.map((b) => b.colorId));
  const layers = new Set(bricks.map((b) => b.z));
  return {
    totalBricks: bricks.length,
    supportBricks: bricks.filter((b) => b.support).length,
    colorKinds: colors.size,
    layerCount: layers.size,
    stepCount: steps.length
  };
}
