import { idx } from './grid';
import { orientationsFor, type OrientedType } from './brickTypes';
import { SUPPORT_COLOR_ID } from './palette';
import type { Brick, BuildStep, Vec3 } from './types';

export interface MergeInput {
  dims: Vec3;
  /** 实心标记(已掏空后的外壳) */
  mask: Uint8Array;
  /** 每体素色卡 id,空心为 null */
  colorIds: (string | null)[];
  enabledBrickTypeIds: ReadonlySet<string>;
  /** 悬空高度超过该层数才标记为悬挑问题(默认 1:任何无咬合都修) */
  cantileverThreshold?: number;
}

export interface MergeResult {
  bricks: Brick[];
  steps: BuildStep[];
  /** 合砖后最终实心占用(含自动支撑) */
  finalMask: Uint8Array;
  /** 每个体素归属的砖 id,空心为 -1 */
  owner: Int32Array;
  supportVoxels: number;
}

interface Candidate {
  o: OrientedType;
  x: number;
  y: number;
  distinct: number;
  area: number;
  aligned: number;
  contacts: number[];
}

/**
 * 贪心分层合砖,硬性保证三条结构不变量:
 *  1. 非落地砖的每块都与至少一块下层砖咬合(否则补 1x1 支撑柱)
 *  2. 无悬空:每个实心体素正下方要么是实心体素,要么已补支撑
 *  3. 层间交错:候选打分惩罚与下层同轮廓对齐,优先跨两块以上下层砖
 */
export function mergeBricks(input: MergeInput): MergeResult {
  const { dims, mask, colorIds } = input;
  const dx = dims.x, dy = dims.y, dz = dims.z;
  const layerSize = dx * dy;
  const orientations = orientationsFor(input.enabledBrickTypeIds);
  const finalMask = mask.slice();
  const owner = new Int32Array(dx * dy * dz).fill(-1);
  const bricks: Brick[] = [];
  let nextId = 0;

  // 落地层 = 最低的含实心体素的层
  let groundZ = dz;
  for (let z = 0; z < dz; z++) {
    let any = false;
    for (let i = z * layerSize; i < (z + 1) * layerSize; i++) if (finalMask[i]) { any = true; break; }
    if (any) { groundZ = z; break; }
  }

  const ensureSupportColumn = (x: number, y: number, fromZ: number) => {
    // 先收集需要补的空格(自上而下),再自底向上建砖,保证柱内逐块咬合
    const gap: number[] = [];
    for (let z = fromZ - 1; z >= groundZ; z--) {
      const vi = idx(x, y, z, dims);
      if (finalMask[vi]) break;
      gap.push(z);
    }
    for (let k = gap.length - 1; k >= 0; k--) {
      const z = gap[k];
      const vi = idx(x, y, z, dims);
      finalMask[vi] = 1;
      const lower: number[] = [];
      if (z > groundZ) {
        const below = owner[idx(x, y, z - 1, dims)];
        if (below >= 0) lower.push(below);
      }
      const sb: Brick = {
        id: nextId++, typeId: 'B11', x, y, z, nx: 1, ny: 1,
        colorId: SUPPORT_COLOR_ID, lowerContacts: lower, upperContacts: [], support: true
      };
      if (lower.length) bricks[lower[0]].upperContacts.push(sb.id);
      owner[vi] = sb.id;
      bricks.push(sb);
    }
    // 柱顶上方若已存在砖(悬挑内腔的硬悬空砖),补建双向咬合
    const topZ = fromZ;
    if (topZ < dims.z) {
      const above = owner[idx(x, y, topZ, dims)];
      if (above >= 0) {
        const top = gap.length ? bricks.find((b) => b.x === x && b.y === y && b.z === topZ - 1) : undefined;
        const topId = top?.id;
        const aboveBrick = bricks[above];
        if (topId !== undefined) {
          if (!aboveBrick.lowerContacts.includes(topId)) aboveBrick.lowerContacts.push(topId);
          if (!bricks[topId].upperContacts.includes(above)) bricks[topId].upperContacts.push(above);
        }
      }
    }
  };

  for (let z = groundZ; z < dz; z++) {
    const layerBase = z * layerSize;
    const occupied = new Uint8Array(layerSize); // 本层已被砖覆盖
    const remaining: number[] = [];
    for (let y = 0; y < dy; y++) {
      for (let x = 0; x < dx; x++) {
        const vi = layerBase + y * dx + x;
        if (finalMask[vi]) remaining.push(y * dx + x);
      }
    }
    // 奇偶层交换扫描方向 → 接缝自然错开
    if (z % 2 === 1) remaining.sort((a, b) => (a % dx) - (b % dx) || Math.floor(a / dx) - Math.floor(b / dx));

    while (remaining.length) {
      const anchorCell = remaining.shift()!;
      if (occupied[anchorCell]) continue;
      const ax = anchorCell % dx;
      const ay = Math.floor(anchorCell / dx);

      let best: Candidate | null = null;
      for (const o of orientations) {
        for (let ox = 0; ox < o.nx; ox++) {
          for (let oy = 0; oy < o.ny; oy++) {
            const x = ax - ox, y = ay - oy;
            if (x < 0 || y < 0 || x + o.nx > dx || y + o.ny > dy) continue;
            let fits = true;
            const colorHere = colorIds[layerBase + anchorCell];
            const contactsSet = new Set<number>();
            let alignedCells = 0;
            for (let yy = 0; yy < o.ny && fits; yy++) {
              for (let xx = 0; xx < o.nx; xx++) {
                const lx = x + xx, ly = y + yy;
                const cell = ly * dx + lx;
                if (occupied[cell] || !finalMask[layerBase + cell]) { fits = false; break; }
                if (colorIds[layerBase + cell] !== colorHere) { fits = false; break; }
                if (z > groundZ) {
                  const belowOwner = owner[idx(lx, ly, z - 1, dims)];
                  if (belowOwner >= 0) {
                    contactsSet.add(belowOwner);
                    // 与下层同一块砖同轮廓对齐 → 整列对齐,惩罚
                    const b = bricks[belowOwner];
                    if (b.x === x && b.y === y && b.nx === o.nx && b.ny === o.ny) alignedCells++;
                  }
                }
              }
            }
            if (!fits) continue;
            const distinct = contactsSet.size;
            // 无任何下层咬合的候选保留但打极低分:
            // 部分悬挑(内腔顶部)允许放置,硬悬空由 1x1 兜底 + 支撑柱处理
            const area = o.nx * o.ny;
            const cand: Candidate = {
              o, x, y, distinct, area,
              aligned: alignedCells, contacts: [...contactsSet]
            };
            if (!best || score(cand, z === groundZ) > score(best, z === groundZ)) best = cand;
          }
        }
      }

      if (!best) {
        // 理论不可达:1x1 候选总会生成。兜底补支撑柱后重试
        ensureSupportColumn(ax, ay, z);
        remaining.unshift(anchorCell);
        continue;
      }

      // 硬悬空(零咬合):先在锚点正下方补支撑柱,再重新选候选
      if (z > groundZ && best.distinct === 0) {
        ensureSupportColumn(ax, ay, z);
        remaining.unshift(anchorCell);
        continue;
      }

      const o = best.o;
      const brick: Brick = {
        id: nextId++,
        typeId: o.typeId,
        x: best.x, y: best.y, z,
        nx: o.nx, ny: o.ny,
        colorId: colorIds[layerBase + anchorCell] ?? SUPPORT_COLOR_ID,
        lowerContacts: best.contacts,
        upperContacts: []
      };
      for (const lowerId of best.contacts) bricks[lowerId].upperContacts.push(brick.id);
      for (let yy = 0; yy < o.ny; yy++) {
        for (let xx = 0; xx < o.nx; xx++) {
          const lx = best.x + xx, ly = best.y + yy;
          const cell = ly * dx + lx;
          occupied[cell] = 1;
          owner[layerBase + cell] = brick.id;
        }
      }
      bricks.push(brick);
      // 移除本砖覆盖的剩余格
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (occupied[remaining[i]]) remaining.splice(i, 1);
      }
    }
  }

  const steps = buildSteps(bricks, groundZ);
  return { bricks, steps, finalMask, owner, supportVoxels: bricks.filter((b) => b.support).length };
}

function score(c: Candidate, isGround: boolean): number {
  if (isGround) return c.area * 10 - c.aligned;
  // 非落地:先保咬合(零咬合 = 硬悬空,压到最低),再保跨砖咬合与砖面积,惩罚整列对齐
  if (c.distinct === 0) return -1_000_000 + c.area;
  return c.distinct * 1000 + c.area * 10 - c.aligned * 50;
}

function buildSteps(bricks: Brick[], groundZ: number): BuildStep[] {
  const byLayer = new Map<number, number[]>();
  for (const b of bricks) {
    if (!byLayer.has(b.z)) byLayer.set(b.z, []);
    byLayer.get(b.z)!.push(b.id);
  }
  const steps: BuildStep[] = [];
  let index = 0;
  for (let z = groundZ; z < Math.max(...byLayer.keys()) + 1; z++) {
    const ids = byLayer.get(z);
    if (!ids || !ids.length) continue;
    steps.push({ index: index++, layer: z, brickIds: ids });
  }
  return steps;
}
