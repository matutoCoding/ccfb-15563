import type { Vec3 } from './types';

/**
 * 三角网格:位置/法线/UV 分别以扁平数组存储(每 3 个浮点数一个向量)。
 * 解析器与程序化生成器都产出这个结构,体素化只依赖它。
 */
export interface TriangleMesh {
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  /** 每三角形 3 个顶点索引 */
  indices: Uint32Array;
  /** 漫反射贴图(可空),RGBA,行优先 */
  albedo?: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };
  /** 每顶点 RGBA(0..255),存在时优先于 baseColor 与贴图 */
  vertexColors?: Uint32Array;
  /** 无贴图时的整体基色 RGBA(0..255) */
  baseColor: number;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export function meshBounds(mesh: TriangleMesh): AABB {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < min.x) min.x = p[i];
    if (p[i + 1] < min.y) min.y = p[i + 1];
    if (p[i + 2] < min.z) min.z = p[i + 2];
    if (p[i] > max.x) max.x = p[i];
    if (p[i + 1] > max.y) max.y = p[i + 1];
    if (p[i + 2] > max.z) max.z = p[i + 2];
  }
  return { min, max };
}

export function triangleCount(mesh: TriangleMesh): number {
  return mesh.indices.length / 3;
}
