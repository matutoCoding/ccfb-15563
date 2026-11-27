import type {
  Brick,
  PartCount,
  StabilityIssue,
  ConvertSettings,
  VoxelGrid,
} from '../types';
import { BRICK_TYPES, PALETTE, SUPPORT_COLOR } from './palette';
import { gridIndexRaw, uid } from './utils';

interface Candidate {
  typeId: string;
  w: number;
  d: number;
  score: number;
}

function brickColor(grid: VoxelGrid, colorIndex: number): string {
  if (colorIndex < PALETTE.length) return PALETTE[colorIndex].id;
  return 'light-gray';
}

function allowedCandidates(settings: ConvertSettings): Array<{ id: string; w: number; d: number }> {
  const enabled = new Set(settings.allowedTypeIds);
  return BRICK_TYPES.filter((t) => enabled.has(t.id)).flatMap((t) => {
    if (t.w === t.d) return [{ id: t.id, w: t.w, d: t.d }];
    return [
      { id: t.id, w: t.w, d: t.d },
      { id: t.id, w: t.d, d: t.w },
    ];
  });
}

export interface PlanResult {
  bricks: Brick[];
  issues: StabilityIssue[];
  partCounts: PartCount[];
  floatingCount: number;
  singleStudCount: number;
}

export function planBricks(
  grid: VoxelGrid,
  settings: ConvertSettings,
): PlanResult {
  const { nx, ny, nz } = grid;
  const candidates = allowedCandidates(settings).sort((a, b) => b.w * b.d - a.w * a.d);
  const bricks: Brick[] = [];
  const occ = new Map<number, string>();
  const brickById = new Map<string, Brick>();
  const key = (x: number, y: number, z: number) => gridIndexRaw(nx, nz, x, y, z);

  let serial = 0;
  let supportSerial = 0;
  let lowerTokens = new Int32Array(nx * nz);
  let lowerTokenBrick = new Map<number, Brick>();

  for (let y = 0; y < ny; y++) {
    const used = new Uint8Array(nx * nz);
    const layerToken = new Int32Array(nx * nz);
    const tokenBrick = new Map<number, Brick>();
    let tokenSerial = 0;

    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const plane = x + nx * z;
        const i = key(x, y, z);
        if (grid.kind[i] === 0 || used[plane]) continue;
        const colorIndex = grid.color[i];

        let best: Candidate | null = null;
        for (const type of candidates) {
          const { w, d } = type;
          const x1 = x + w - 1;
          const z1 = z + d - 1;
          if (x1 >= nx || z1 >= nz) continue;

          let fits = true;
          let overlap = 0;
          const lowerIds = new Set<number>();
          for (let dz = 0; dz < d && fits; dz++) {
            for (let dx = 0; dx < w; dx++) {
              const xx = x + dx;
              const zz = z + dz;
              const p = xx + nx * zz;
              const ii = key(xx, y, zz);
              if (grid.kind[ii] === 0 || used[p] || grid.color[ii] !== colorIndex) {
                fits = false;
                break;
              }
              if (y > 0) {
                // layerToken is current layer; lower tokens were saved below.
              }
            }
          }
          if (!fits) continue;

          if (y > 0) {
            for (let dz = 0; dz < d; dz++) {
              for (let dx = 0; dx < w; dx++) {
                const xx = x + dx;
                const zz = z + dz;
                const lower = lowerTokens[xx + nx * zz];
                if (lower > 0) {
                  overlap++;
                  lowerIds.add(lower);
                }
              }
            }
          }

          const area = w * d;
          const distinct = lowerIds.size;
          let exactAligned = false;
          if (distinct === 1) {
            const lowerBrick = lowerTokenBrick.get([...lowerIds][0]);
            if (
              lowerBrick &&
              lowerBrick.x === x &&
              lowerBrick.z === z &&
              lowerBrick.w === w &&
              lowerBrick.d === d
            ) {
              exactAligned = true;
            }
          }

          let score = area * 520 + overlap * 145 + distinct * 130;
          if (distinct >= 2) score += 320;
          if (exactAligned) score -= 1100;
          if (overlap === 0 && y > 0) score -= 900;
          // Alternate the preferred long axis to create running-bond courses.
          if (settings.staggerBonds) {
            const longX = w >= d;
            if ((y % 2 === 0 && longX) || (y % 2 === 1 && !longX)) score += 22;
          }
          // Slightly prefer longer rectangles of the same area.
          score += Math.max(w, d) * 4;

          if (!best || score > best.score) best = { typeId: type.id, w, d, score };
        }

        // 1x1 is always a legal fallback for a single unassigned voxel.
        const chosen = best ?? { typeId: 'b11', w: 1, d: 1, score: 1000 };
        const id = uid('b');
        const brick: Brick = {
          id,
          typeId: chosen.typeId,
          w: chosen.w,
          d: chosen.d,
          x,
          y,
          z,
          colorId: brickColor(grid, colorIndex),
        };
        bricks.push(brick);
        brickById.set(id, brick);
        serial++;
        const token = ++tokenSerial;
        tokenBrick.set(token, brick);

        for (let dz = 0; dz < chosen.d; dz++) {
          for (let dx = 0; dx < chosen.w; dx++) {
            const xx = x + dx;
            const zz = z + dz;
            const p = xx + nx * zz;
            used[p] = 1;
            layerToken[p] = token;
            occ.set(key(xx, y, zz), id);
          }
        }
      }
    }

    lowerTokens = layerToken;
    lowerTokenBrick = tokenBrick;
  }

  const overlapCells = (b: Brick, deltaY: -1 | 1): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    const yy = b.y + deltaY;
    if (yy < 0 || yy >= ny) return out;
    for (let dz = 0; dz < b.d; dz++) {
      for (let dx = 0; dx < b.w; dx++) {
        const cx = b.x + dx;
        const cz = b.z + dz;
        if (occ.has(key(cx, yy, cz))) out.push([cx, cz]);
      }
    }
    return out;
  };

  const addSupportColumn = (cx: number, brickY: number, cz: number): void => {
    for (let y = brickY - 1; y >= 0; y--) {
      if (occ.has(key(cx, y, cz))) return;
      const id = `support_${supportSerial++}`;
      const b: Brick = {
        id,
        typeId: 'b11',
        w: 1,
        d: 1,
        x: cx,
        y,
        z: cz,
        colorId: SUPPORT_COLOR.id,
        support: true,
        auto: true,
      };
      bricks.push(b);
      brickById.set(id, b);
      occ.set(key(cx, y, cz), id);
    }
  };

  const supportCost = (cx: number, brickY: number, cz: number): number => {
    for (let y = brickY - 1; y >= 0; y--) {
      if (occ.has(key(cx, y, cz))) return brickY - 1 - y;
    }
    return brickY;
  };

  const bestAnchor = (b: Brick, requireEmptyBelow: boolean): [number, number] => {
    let best: [number, number] = [b.x, b.z];
    let bestCost = Infinity;
    for (let dz = 0; dz < b.d; dz++) {
      for (let dx = 0; dx < b.w; dx++) {
        const cx = b.x + dx;
        const cz = b.z + dz;
        if (requireEmptyBelow && occ.has(key(cx, b.y - 1, cz))) continue;
        const cost = supportCost(cx, b.y, cz);
        if (cost < bestCost) {
          bestCost = cost;
          best = [cx, cz];
        }
      }
    }
    return best;
  };

  if (settings.autoSupport) {
    const original = bricks.filter((b) => !b.support).sort((a, b) => a.y - b.y);
    for (const b of original) {
      if (b.y === 0) continue;
      let lower = overlapCells(b, -1);
      if (lower.length === 0) {
        const [cx, cz] = bestAnchor(b, false);
        addSupportColumn(cx, b.y, cz);
        lower = overlapCells(b, -1);
      }

      // A rectangle with more than one stud can be given a second clutch point.
      if (settings.reinforceSingleStuds && lower.length === 1 && b.w * b.d > 1) {
        const [cx, cz] = bestAnchor(b, true);
        addSupportColumn(cx, b.y, cz);
      }
    }
  }

  const issues: StabilityIssue[] = [];
  let floatingCount = 0;
  let singleStudCount = 0;

  for (const b of bricks) {
    const lower = b.y === 0 ? b.w * b.d : overlapCells(b, -1).length;
    const upper = overlapCells(b, 1).length;
    b.lowerStuds = lower;
    b.upperStuds = upper;

    if (b.y > 0 && lower === 0) {
      floatingCount++;
      issues.push({
        id: uid('issue'),
        brickId: b.id,
        layer: b.y,
        kind: 'floating',
        severity: 'error',
        message: `第 ${b.y + 1} 层 ${b.w}×${b.d} 砖悬空，未与下层咬合`,
        studs: 0,
      });
    } else if (!b.support && b.y > 0 && lower === 1) {
      singleStudCount++;
      issues.push({
        id: uid('issue'),
        brickId: b.id,
        layer: b.y,
        kind: 'single-stud',
        severity: 'warning',
        message: `第 ${b.y + 1} 层 ${b.w}×${b.d} 砖仅靠 1 个凸点连接，建议加强或改型`,
        studs: 1,
      });
    }
  }

  const counts = new Map<string, PartCount>();
  for (const b of bricks) {
    const k = `${b.typeId}|${b.colorId}|${b.support ? 's' : 'n'}`;
    const existing = counts.get(k);
    if (existing) existing.quantity++;
    else counts.set(k, { typeId: b.typeId, colorId: b.colorId, quantity: 1, support: b.support });
  }
  const partCounts = [...counts.values()].sort((a, b) =>
    `${a.typeId}${a.colorId}`.localeCompare(`${b.typeId}${b.colorId}`),
  );

  // Invariant relied on by the UI/export: auto-support removes every floating brick.
  if (settings.autoSupport && floatingCount > 0) {
    throw new Error('支撑生成后仍存在悬空砖');
  }

  return { bricks, issues, partCounts, floatingCount, singleStudCount };
}
