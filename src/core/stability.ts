import { idx } from './grid';
import { SUPPORT_COLOR_ID } from './palette';
import type { Brick, StabilityIssue, StabilityReport, Vec3 } from './types';

export interface StabilityInput {
  dims: Vec3;
  bricks: Brick[];
  /** 体素 → 砖 id */
  owner: Int32Array;
  mask: Uint8Array;
  /** 落地层 */
  groundZ: number;
}

/**
 * 结构稳定性核查。merger 已硬性消除悬空,这里做独立复核并找出脆弱点:
 * - floating:砖与下层/地面零咬合(结构红线,理论上不出现,出现即 bug)
 * - single-contact:非落地砖只与一块下层砖咬合,受侧向力易脱
 * - cantilever:砖的部分体素正下方无任何体素(悬挑),越长越危险
 */
export function analyzeStability(input: StabilityInput): StabilityReport {
  const { dims, bricks, mask, groundZ } = input;
  const issues: StabilityIssue[] = [];
  let interlockedCells = 0;
  let totalCellsAboveGround = 0;
  let floatingCount = 0;

  for (const b of bricks) {
    if (b.z === groundZ) continue;
    const footprint = b.nx * b.ny;
    totalCellsAboveGround += footprint;

    if (b.lowerContacts.length === 0) {
      floatingCount++;
      issues.push({
        kind: 'floating', brickId: b.id, at: { x: b.x, y: b.y, z: b.z },
        message: `砖 ${b.typeId} 完全悬空,无任何下层咬合`
      });
    } else if (b.lowerContacts.length === 1) {
      issues.push({
        kind: 'single-contact', brickId: b.id, at: { x: b.x, y: b.y, z: b.z },
        message: `砖 ${b.typeId} 仅与 1 块下层砖咬合,建议跨砖放置`
      });
    }

    let covered = 0;
    let overhang = 0;
    for (let yy = 0; yy < b.ny; yy++) {
      for (let xx = 0; xx < b.nx; xx++) {
        const lx = b.x + xx, ly = b.y + yy;
        const belowVi = idx(lx, ly, b.z - 1, dims);
        if (mask[belowVi]) {
          covered++;
          interlockedCells++;
        } else {
          overhang++;
        }
      }
    }
    if (overhang > 0 && covered > 0) {
      issues.push({
        kind: 'cantilever', brickId: b.id,
        at: { x: b.x, y: b.y, z: b.z },
        message: `砖 ${b.typeId} 有 ${overhang}/${footprint} 个体素悬挑无下方支撑`
      });
    }
  }

  return {
    issues: issues.sort((a, b) => severity(b.kind) - severity(a.kind)),
    interlockRatio: totalCellsAboveGround ? interlockedCells / totalCellsAboveGround : 1,
    floatingCount
  };
}

function severity(k: StabilityIssue['kind']): number {
  return k === 'floating' ? 3 : k === 'cantilever' ? 2 : 1;
}

/**
 * 自动加固:对每个悬挑/单点砖,在悬挑体素下方补 1x1 支撑柱到地面或实心层。
 * 直接在既有砖表上增量修改,补完后重新分析应无 floating、cantilever。
 */
export function addSupports(input: StabilityInput): { added: Brick[]; report: StabilityReport } {
  const { dims, bricks, owner, mask, groundZ } = input;
  const added: Brick[] = [];
  let nextId = Math.max(-1, ...bricks.map((b) => b.id)) + 1;
  const brickById = new Map(bricks.map((b) => [b.id, b]));

  const fillColumn = (x: number, y: number, fromZ: number) => {
    const gap: number[] = [];
    for (let z = fromZ; z >= groundZ; z--) {
      if (mask[idx(x, y, z, dims)]) break;
      gap.push(z);
    }
    let topId: number | undefined;
    for (let k = gap.length - 1; k >= 0; k--) {
      const z = gap[k];
      const vi = idx(x, y, z, dims);
      mask[vi] = 1;
      const lower: number[] = [];
      if (z > groundZ) {
        const below = owner[idx(x, y, z - 1, dims)];
        if (below >= 0) lower.push(below);
      }
      const sb: Brick = {
        id: nextId++, typeId: 'B11', x, y, z, nx: 1, ny: 1,
        colorId: SUPPORT_COLOR_ID, lowerContacts: lower, upperContacts: [], support: true
      };
      if (lower.length) brickById.get(lower[0])?.upperContacts.push(sb.id);
      owner[vi] = sb.id;
      bricks.push(sb);
      added.push(sb);
      brickById.set(sb.id, sb);
      topId = sb.id;
    }
    // 柱顶与上方砖补建双向咬合
    const aboveZ = fromZ + 1;
    if (topId !== undefined && aboveZ < dims.z) {
      const above = owner[idx(x, y, aboveZ, dims)];
      if (above >= 0) {
        const ab = brickById.get(above);
        if (ab && !ab.lowerContacts.includes(topId)) {
          ab.lowerContacts.push(topId);
          brickById.get(topId)?.upperContacts.push(above);
        }
      }
    }
  };

  const risky = bricks.filter(
    (b) => b.z > groundZ && (b.lowerContacts.length <= 1 || hasOverhang(b, dims, mask))
  );
  for (const b of risky) {
    for (let yy = 0; yy < b.ny; yy++) {
      for (let xx = 0; xx < b.nx; xx++) {
        const lx = b.x + xx, ly = b.y + yy;
        if (!mask[idx(lx, ly, b.z - 1, dims)]) fillColumn(lx, ly, b.z - 1);
      }
    }
  }

  const report = analyzeStability({ dims, bricks, owner, mask, groundZ });
  return { added, report };
}

function hasOverhang(b: Brick, dims: Vec3, mask: Uint8Array): boolean {
  for (let yy = 0; yy < b.ny; yy++) {
    for (let xx = 0; xx < b.nx; xx++) {
      if (!mask[idx(b.x + xx, b.y + yy, b.z - 1, dims)]) return true;
    }
  }
  return false;
}
