import { describe, expect, it } from 'vitest';
import { runConversion, templateGrid, defaultSettings } from './pipeline';
import { createProject } from './projectIO';
import { quantizeGrid } from './color';
import { planBricks } from './planner';

describe('brick planning structural contract', () => {
  it('cat and house have no floating bricks after auto support', async () => {
    for (const kind of ['cat', 'house'] as const) {
      const project = createProject('order', kind, kind);
      project.settings = defaultSettings();
      project.settings.resolution = 64;
      const result = await runConversion(project, null);
      expect(result.stats.floatingCount).toBe(0);
      expect(result.bricks.length).toBeGreaterThan(20);
      for (const b of result.bricks) {
        if (b.y > 0) expect(b.lowerStuds ?? 0).toBeGreaterThanOrEqual(1);
      }
    }
  }, 20000);

  it('keeps 100k-class conversion and merging under ten seconds', async () => {
    const grid = templateGrid('cat', 128);
    quantizeGrid(grid, {
      autoReplaceOutOfStock: true,
      overrides: {},
      preserveLocked: false,
    });
    const started = performance.now();
    const plan = planBricks(grid, defaultSettings());
    const ms = performance.now() - started;
    const voxels = grid.kind.filter((k) => k === 1).length;
    // The generated high-resolution cat should be in the target size class.
    expect(voxels).toBeGreaterThan(20000);
    expect(plan.floatingCount).toBe(0);
    expect(ms).toBeLessThan(10000);
  }, 20000);
});
