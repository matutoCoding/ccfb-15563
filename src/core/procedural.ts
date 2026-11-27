import { rgba } from './grid';
import type { TriangleMesh } from './mesh';

/**
 * 程序化模型生成:没有客户模型时,直接生成可走完整体素化管线的三角网格。
 * 坐标约定 z 向上,模型大致落在 1 单位立方体内。
 */

interface Builder {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

const builder = (): Builder => ({ pos: [], nor: [], uv: [], col: [], idx: [] });

function pushVert(b: Builder, p: number[], n: number[], uv: number[], color: number) {
  b.pos.push(...p);
  b.nor.push(...n);
  b.uv.push(...uv);
  b.col.push(color);
}

function addBox(
  b: Builder,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  color: number
) {
  const base = b.pos.length / 3;
  const corners = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]
  ];
  for (const c of corners) pushVert(b, [cx + c[0], cy + c[1], cz + c[2]], [0, 0, 1], [0, 0], color);
  const faces: Array<[number[], number[]]> = [
    [[0, 3, 2], [0, 2, 1]], // -z
    [[4, 5, 6], [4, 6, 7]], // +z
    [[0, 1, 5], [0, 5, 4]], // -y
    [[2, 3, 7], [2, 7, 6]], // +y
    [[0, 4, 7], [0, 7, 3]], // -x
    [[1, 2, 6], [1, 6, 5]] // +x
  ];
  const faceN = [
    [0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]
  ];
  faces.forEach((f, fi) => {
    for (const tri of f) {
      for (const vi of tri) {
        const gi = base + vi;
        b.nor[gi * 3] = faceN[fi][0];
        b.nor[gi * 3 + 1] = faceN[fi][1];
        b.nor[gi * 3 + 2] = faceN[fi][2];
        b.idx.push(gi);
      }
    }
  });
}

function addEllipsoid(
  b: Builder,
  cx: number, cy: number, cz: number,
  rx: number, ry: number, rz: number,
  color: number,
  segU = 18, segV = 12
) {
  const base = b.pos.length / 3;
  for (let v = 0; v <= segV; v++) {
    const phi = (v / segV) * Math.PI;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    for (let u = 0; u <= segU; u++) {
      const theta = (u / segU) * Math.PI * 2;
      const st = Math.sin(theta), ct = Math.cos(theta);
      const px = rx * sp * ct, py = ry * sp * st, pz = rz * cp;
      pushVert(
        b,
        [cx + px, cy + py, cz + pz],
        norm3(px / (rx * rx), py / (ry * ry), pz / (rz * rz)),
        [u / segU, v / segV],
        color
      );
    }
  }
  const row = segU + 1;
  for (let v = 0; v < segV; v++) {
    for (let u = 0; u < segU; u++) {
      const a = base + v * row + u;
      const c = a + row;
      b.idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
}

function addCone(
  b: Builder,
  cx: number, cy: number, z0: number,
  r: number, h: number,
  color: number,
  seg = 14
) {
  const base = b.pos.length / 3;
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const x = Math.cos(t) * r, y = Math.sin(t) * r;
    pushVert(b, [cx + x, cy + y, z0], norm3(x, y, 0), [i / seg, 0], color);
  }
  const tip = b.pos.length / 3;
  pushVert(b, [cx, cy, z0 + h], [0, 0, 1], [0.5, 1], color);
  for (let i = 0; i < seg; i++) b.idx.push(base + i, base + i + 1, tip);
}

function norm3(x: number, y: number, z: number): number[] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function toMesh(b: Builder): TriangleMesh {
  return {
    positions: Float32Array.from(b.pos),
    normals: Float32Array.from(b.nor),
    uvs: Float32Array.from(b.uv),
    vertexColors: Uint32Array.from(b.col),
    indices: Uint32Array.from(b.idx),
    baseColor: rgba(200, 200, 200)
  };
}

/** 坐着的猫:梨形身体 + 头 + 耳 + 吻部 + 前腿 + 爪 + 卷尾 */
export function createCatMesh(): TriangleMesh {
  const b = builder();
  const orange = rgba(214, 138, 54);
  const orangeDark = rgba(178, 102, 32);
  const cream = rgba(242, 222, 188);
  const pink = rgba(232, 150, 160);
  const dark = rgba(48, 36, 30);

  addEllipsoid(b, 0, 0, 0.34, 0.4, 0.34, 0.42, orange); // 身体
  addEllipsoid(b, 0, 0.02, 0.12, 0.3, 0.26, 0.2, cream); // 肚皮
  addEllipsoid(b, 0, 0, 0.74, 0.27, 0.25, 0.26, orange); // 头
  addEllipsoid(b, 0, 0.06, 0.66, 0.15, 0.13, 0.1, cream); // 吻部
  addEllipsoid(b, 0, 0.16, 0.7, 0.035, 0.025, 0.03, pink); // 鼻子
  addEllipsoid(b, -0.1, 0.2, 0.78, 0.045, 0.04, 0.05, dark); // 眼
  addEllipsoid(b, 0.1, 0.2, 0.78, 0.045, 0.04, 0.05, dark);
  addCone(b, -0.15, 0, 0.94, 0.09, 0.16, orangeDark); // 耳
  addCone(b, 0.15, 0, 0.94, 0.09, 0.16, orangeDark);
  addEllipsoid(b, -0.16, 0.2, 0.16, 0.09, 0.1, 0.18, orange); // 前腿
  addEllipsoid(b, 0.16, 0.2, 0.16, 0.09, 0.1, 0.18, orange);
  addEllipsoid(b, -0.16, 0.26, 0.03, 0.1, 0.08, 0.05, cream); // 前爪
  addEllipsoid(b, 0.16, 0.26, 0.03, 0.1, 0.08, 0.05, cream);
  addEllipsoid(b, -0.26, -0.12, 0.06, 0.14, 0.16, 0.1, orangeDark); // 后爪
  addEllipsoid(b, 0.26, -0.12, 0.06, 0.14, 0.16, 0.1, orangeDark);
  // 卷尾:沿弧线一串椭球
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const ang = t * Math.PI * 0.9;
    const x = 0.3 + Math.cos(ang) * 0.16 * (1 - t * 0.4);
    const y = -0.22 - Math.sin(ang) * 0.22;
    const z = 0.06 + t * 0.42;
    const r = 0.07 * (1 - t * 0.45);
    addEllipsoid(b, x, y, z, r, r, r * 1.2, orangeDark, 12, 8);
  }
  return toMesh(b);
}

/** 小房子:墙身 + 金字塔屋顶 + 门窗 + 烟囱 + 底座 */
export function createHouseMesh(): TriangleMesh {
  const b = builder();
  const wall = rgba(238, 226, 200);
  const roof = rgba(178, 64, 52);
  const wood = rgba(110, 72, 40);
  const glass = rgba(120, 180, 214);
  const stone = rgba(150, 146, 140);

  addBox(b, 0, 0, 0.04, 0.52, 0.46, 0.04, stone); // 底座
  addBox(b, 0, 0, 0.34, 0.42, 0.36, 0.26, wall); // 墙
  addPyramid(b, 0, 0, 0.6, 0.5, 0.44, 0.24, roof); // 屋顶
  addBox(b, 0.24, -0.1, 0.72, 0.06, 0.06, 0.16, stone); // 烟囱
  addBox(b, 0, 0.365, 0.2, 0.1, 0.02, 0.16, wood); // 门
  addBox(b, -0.22, 0.365, 0.4, 0.08, 0.02, 0.08, glass); // 窗
  addBox(b, 0.22, 0.365, 0.4, 0.08, 0.02, 0.08, glass);
  addBox(b, -0.425, 0.1, 0.4, 0.02, 0.08, 0.08, glass);
  return toMesh(b);
}

function addPyramid(
  b: Builder, cx: number, cy: number, z0: number,
  hx: number, hy: number, h: number, color: number
) {
  const base = b.pos.length / 3;
  const cs = [
    [cx - hx, cy - hy, z0], [cx + hx, cy - hy, z0],
    [cx + hx, cy + hy, z0], [cx - hx, cy + hy, z0]
  ];
  const tip = [cx, cy, z0 + h];
  for (const c of cs) pushVert(b, c, [0, 0, 1], [0, 0], color);
  const tipIdx = b.pos.length / 3;
  pushVert(b, tip, [0, 0, 1], [0.5, 1], color);
  const faces = [[0, 1], [1, 2], [2, 3], [3, 0]];
  for (const [i, j] of faces) {
    const p0 = cs[i], p1 = cs[j];
    const n = norm3(
      (p1[1] - p0[1]) * (tip[2] - p0[2]) - (p1[2] - p0[2]) * (tip[1] - p0[1]),
      (p1[2] - p0[2]) * (tip[0] - p0[0]) - (p1[0] - p0[0]) * (tip[2] - p0[2]),
      (p1[0] - p0[0]) * (tip[1] - p0[1]) - (p1[1] - p0[1]) * (tip[0] - p0[0])
    );
    for (const vi of [base + i, base + j, tipIdx]) {
      b.nor[vi * 3] = n[0];
      b.nor[vi * 3 + 1] = n[1];
      b.nor[vi * 3 + 2] = n[2];
      b.idx.push(vi);
    }
  }
}
