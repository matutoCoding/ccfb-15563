import { describe, expect, it } from 'vitest';
import { createProject, projectToJson, parseProjectJson } from './projectIO';
import { runConversion } from './pipeline';

describe('project interchange', () => {
  it('round-trips orders, typed voxel arrays, bricks and stats', async () => {
    const project = createProject('order-1', '猫', 'cat');
    const result = await runConversion(project, null);
    const full = { ...project, ...result };
    const json = projectToJson(full);
    const back = parseProjectJson(json);

    expect(back.orderId).toBe('order-1');
    expect(back.bricks).toHaveLength(full.bricks.length);
    expect(back.grid?.nx).toBe(full.grid?.nx);
    expect(back.grid?.kind).toBeInstanceOf(Uint8Array);
    expect(back.grid?.color).toBeInstanceOf(Uint8Array);
    expect(back.grid?.sourceRGB).toBeInstanceOf(Int32Array);
    expect(Array.from(back.grid!.kind)).toEqual(Array.from(full.grid!.kind));
    expect(back.stats?.floatingCount).toBe(0);
  });
});
