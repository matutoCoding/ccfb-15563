import { idx, inside, rgba, r8, g8, b8 } from './grid';
import type { TriangleMesh } from './mesh';
import type { Vec3 } from './types';

export interface VoxelizeOptions {
  /** 最长边目标体素数 */
  resolution: number;
  /** 网格四周留白体素数 */
  padding?: number;
}

export interface VoxelizeResult {
  dims: Vec3;
  origin: Vec3;
  spacing: number;
  /** 0=外部空气 1=实心 */
  mask: Uint8Array;
  /** 每体素颜色(仅实心有效),RGBA 打包 */
  colors: Uint32Array;
  voxelSizeMm: number;
}

/**
 * 三角形与轴对齐盒子重叠测试(Akenine-Möller SAT,盒子中心在原点、半边长 h)。
 * 纯数值运算,GPU WGSL 端为同一算法的逐行移植,两侧结果必须一致。
 */
export function triBoxOverlap(
  boxHalf: number,
  tv: ArrayLike<number>,
  _stride: number,
  o0: number, o1: number, o2: number
): boolean {
  // 相对容差:吸收三角形与格子边界精确共面时的浮点误差(实测误差 ~3e-8 倍)
  const eps = 1 + 1e-7;
  const v0 = [tv[o0], tv[o0 + 1], tv[o0 + 2]];
  const v1 = [tv[o1], tv[o1 + 1], tv[o1 + 2]];
  const v2 = [tv[o2], tv[o2 + 1], tv[o2 + 2]];
  const e0 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
  const e2 = [v0[0] - v2[0], v0[1] - v2[1], v0[2] - v2[2]];
  const min = (a: number[]) => Math.min(a[0], a[1], a[2]);
  const max = (a: number[]) => Math.max(a[0], a[1], a[2]);

  // 9 条分离轴:三角形边 × 盒子轴
  const axisTests: Array<[number, number, number]> = [
    [e0[1], -e0[0], 0], [e0[2], 0, -e0[0]], [0, e0[2], -e0[1]],
    [e1[1], -e1[0], 0], [e1[2], 0, -e1[0]], [0, e1[2], -e1[1]],
    [e2[1], -e2[0], 0], [e2[2], 0, -e2[0]], [0, e2[2], -e2[1]]
  ];
  for (const [ax, ay, az] of axisTests) {
    const p0 = ax * v0[0] + ay * v0[1] + az * v0[2];
    const p1 = ax * v1[0] + ay * v1[1] + az * v1[2];
    const p2 = ax * v2[0] + ay * v2[1] + az * v2[2];
    const r = boxHalf * (Math.abs(ax) + Math.abs(ay) + Math.abs(az)) * eps;
    if (Math.max(-Math.max(p0, p1, p2), Math.min(p0, p1, p2)) > r) return false;
  }
  // 盒子三个轴:顶点区间是否全在盒外(同样加容差处理共面)
  const dx = [v0[0], v1[0], v2[0]], dy = [v0[1], v1[1], v2[1]], dz = [v0[2], v1[2], v2[2]];
  if (max(dx) < -boxHalf * eps || min(dx) > boxHalf * eps) return false;
  if (max(dy) < -boxHalf * eps || min(dy) > boxHalf * eps) return false;
  if (max(dz) < -boxHalf * eps || min(dz) > boxHalf * eps) return false;
  // 三角形面法线
  const nx = e0[1] * e1[2] - e0[2] * e1[1];
  const ny = e0[2] * e1[0] - e0[0] * e1[2];
  const nz = e0[0] * e1[1] - e0[1] * e1[0];
  const pts = [
    nx * v0[0] + ny * v0[1] + nz * v0[2],
    nx * v1[0] + ny * v1[1] + nz * v1[2],
    nx * v2[0] + ny * v2[1] + nz * v2[2]
  ];
  const r = boxHalf * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz)) * eps;
  return !(Math.max(-Math.max(pts[0], pts[1], pts[2]), Math.min(pts[0], pts[1], pts[2])) > r);
}

/** CPU 体素化:逐三角形扫 AABB 覆盖的格子做重叠测试,再泛洪填充内部 */
export function voxelizeCPU(mesh: TriangleMesh, opts: VoxelizeOptions): VoxelizeResult {
  const padding = opts.padding ?? 1;
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    mnx = Math.min(mnx, p[i]); mny = Math.min(mny, p[i + 1]); mnz = Math.min(mnz, p[i + 2]);
    mxx = Math.max(mxx, p[i]); mxy = Math.max(mxy, p[i + 1]); mxz = Math.max(mxz, p[i + 2]);
  }
  const span = Math.max(mxx - mnx, mxy - mny, mxz - mnz) || 1;
  const spacing = span / opts.resolution;
  const dims: Vec3 = {
    x: Math.ceil((mxx - mnx) / spacing) + padding * 2,
    y: Math.ceil((mxy - mny) / spacing) + padding * 2,
    z: Math.ceil((mxz - mnz) / spacing) + padding * 2
  };
  const total = dims.x * dims.y * dims.z;
  const mask = new Uint8Array(total);
  const colors = new Uint32Array(total);
  const origin = { x: mnx - padding * spacing, y: mny - padding * spacing, z: mnz - padding * spacing };

  const ind = mesh.indices;
  const cell = (v: number) => ({
    x: Math.floor((p[v] - origin.x) / spacing),
    y: Math.floor((p[v + 1] - origin.y) / spacing),
    z: Math.floor((p[v + 2] - origin.z) / spacing)
  });
  const h = spacing / 2;

  for (let t = 0; t < ind.length; t += 3) {
    const a = ind[t] * 3, b = ind[t + 1] * 3, c = ind[t + 2] * 3;
    const ca = cell(a), cb = cell(b), cc = cell(c);
    const x0 = Math.max(0, Math.min(ca.x, cb.x, cc.x));
    const x1 = Math.min(dims.x - 1, Math.max(ca.x, cb.x, cc.x));
    const y0 = Math.max(0, Math.min(ca.y, cb.y, cc.y));
    const y1 = Math.min(dims.y - 1, Math.max(ca.y, cb.y, cc.y));
    const z0 = Math.max(0, Math.min(ca.z, cb.z, cc.z));
    const z1 = Math.min(dims.z - 1, Math.max(ca.z, cb.z, cc.z));
    const triColor = triangleColor(mesh, ind[t], ind[t + 1], ind[t + 2]);
    // 平移到以格子中心为原点的局部坐标
    const tv = new Float32Array(9);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const cx = origin.x + (x + 0.5) * spacing;
          const cy = origin.y + (y + 0.5) * spacing;
          const cz = origin.z + (z + 0.5) * spacing;
          tv.set([p[a] - cx, p[a + 1] - cy, p[a + 2] - cz,
            p[b] - cx, p[b + 1] - cy, p[b + 2] - cz,
            p[c] - cx, p[c + 1] - cy, p[c + 2] - cz]);
          if (triBoxOverlap(h, tv, 3, 0, 3, 6)) {
            const vi = idx(x, y, z, dims);
            if (!mask[vi]) {
              mask[vi] = 1;
              colors[vi] = triColor;
            }
          }
        }
      }
    }
  }

  fillInterior(mask, dims);
  return { dims, origin, spacing, mask, colors, voxelSizeMm: spacing };
}

/** 泛洪填充:从网格边界的空格子出发,访问不到的空格子就是模型内部,标实心 */
export function fillInterior(mask: Uint8Array, dims: Vec3): void {
  const { x: dx, y: dy, z: dz } = dims;
  const outside = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0, tail = 0;
  const push = (i: number) => { outside[i] = 1; queue[tail++] = i; };
  for (let x = 0; x < dx; x++) {
    for (let y = 0; y < dy; y++) {
      const a = idx(x, y, 0, dims), b = idx(x, y, dz - 1, dims);
      if (!mask[a] && !outside[a]) push(a);
      if (!mask[b] && !outside[b]) push(b);
    }
  }
  for (let z = 0; z < dz; z++) {
    for (const y of [0, dy - 1]) {
      for (let x = 0; x < dx; x++) {
        const i = idx(x, y, z, dims);
        if (!mask[i] && !outside[i]) push(i);
      }
    }
    for (const x of [0, dx - 1]) {
      for (let y = 0; y < dy; y++) {
        const i = idx(x, y, z, dims);
        if (!mask[i] && !outside[i]) push(i);
      }
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % dx;
    const y = Math.floor(i / dx) % dy;
    const z = Math.floor(i / (dx * dy));
    const tries = [
      x > 0 ? i - 1 : -1, x < dx - 1 ? i + 1 : -1,
      y > 0 ? i - dx : -1, y < dy - 1 ? i + dx : -1,
      z > 0 ? i - dx * dy : -1, z < dz - 1 ? i + dx * dy : -1
    ];
    for (const n of tries) {
      if (n >= 0 && !mask[n] && !outside[n]) push(n);
    }
  }
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] && !outside[i]) mask[i] = 1;
  }
}

/**
 * 外壳掏空:保留到外部空气的切比雪夫距离 <= shell 的实心体素。
 * 距离场用 26 邻接 BFS 精确计算;所有表面体素距离恒为 1,因此薄壁不会被切断。
 * 底层(z 最小实心层)整体保留,保证模型能站住且与底板咬合。
 */
export function hollowShell(mask: Uint8Array, dims: Vec3, shell: number): Uint8Array {
  const { x: dx, y: dy, z: dz } = dims;
  const n = mask.length;
  const dist = new Int16Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  // 多源 BFS:所有外部空气格作为距离 0 的源
  for (let i = 0; i < n; i++) {
    if (!mask[i]) { dist[i] = 0; queue[tail++] = i; }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % dx;
    const y = Math.floor(i / dx) % dy;
    const z = Math.floor(i / (dx * dy));
    const d1 = dist[i] + 1;
    for (let oz = -1; oz <= 1; oz++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy && !oz) continue;
          const nx = x + ox, ny = y + oy, nz = z + oz;
          if (!inside(nx, ny, nz, dims)) continue;
          const ni = idx(nx, ny, nz, dims);
          if (dist[ni] === -1) { dist[ni] = d1; queue[tail++] = ni; }
        }
      }
    }
  }
  const out = new Uint8Array(n);
  let bottomSolidZ = dz;
  for (let z = 0; z < dz; z++) {
    let any = false;
    for (let i = z * dx * dy; i < (z + 1) * dx * dy; i++) if (mask[i]) { any = true; break; }
    if (any) { bottomSolidZ = z; break; }
  }
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const z = Math.floor(i / (dx * dy));
    if (z === bottomSolidZ || (dist[i] !== -1 && dist[i] <= shell)) out[i] = 1;
  }
  return out;
}

function triangleColor(mesh: TriangleMesh, ia: number, ib: number, ic: number): number {
  if (mesh.vertexColors) {
    let r = 0, g = 0, b = 0;
    for (const vi of [ia, ib, ic]) {
      const c = mesh.vertexColors[vi];
      r += r8(c); g += g8(c); b += b8(c);
    }
    return rgba(r / 3, g / 3, b / 3);
  }
  if (mesh.albedo && mesh.uvs) {
    let u = 0, v = 0;
    for (const vi of [ia, ib, ic]) { u += mesh.uvs[vi * 2]; v += mesh.uvs[vi * 2 + 1]; }
    u /= 3; v /= 3;
    const tex = mesh.albedo;
    const tx = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width)));
    const ty = Math.min(tex.height - 1, Math.max(0, Math.floor((1 - v) * tex.height)));
    const o = (ty * tex.width + tx) * 4;
    return rgba(tex.data[o], tex.data[o + 1], tex.data[o + 2], tex.data[o + 3] ?? 255);
  }
  return mesh.baseColor;
}
