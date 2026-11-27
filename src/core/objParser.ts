import { rgba, r8, g8, b8 } from './grid';
import type { TriangleMesh } from './mesh';

/** OBJ 解析:v/vt/vn/f,支持四边形三角化、单文件多组、MTL 基色与贴图 */
export function parseOBJ(text: string, mtl?: Map<string, number>, textureImage?: ImageData): TriangleMesh {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [];
  const outPos: number[] = [], outUv: number[] = [], outNor: number[] = [];
  const indices: number[] = [];
  let currentColor = rgba(200, 200, 200);
  let hasNormal = false;

  const vert = (tok: string): number => {
    const parts = tok.split('/');
    const vi = parseInt(parts[0], 10);
    const ti = parts[1] ? parseInt(parts[1], 10) : 0;
    const ni = parts[2] ? parseInt(parts[2], 10) : 0;
    const pi = vi > 0 ? vi - 1 : pos.length / 3 + vi;
    const base = outPos.length / 3;
    outPos.push(pos[pi * 3], pos[pi * 3 + 1], pos[pi * 3 + 2]);
    if (ti && uv.length) {
      const ui = ti > 0 ? ti - 1 : uv.length / 2 + ti;
      outUv.push(uv[ui * 2], uv[ui * 2 + 1]);
    } else outUv.push(0, 0);
    if (ni && nor.length) {
      const nui = ni > 0 ? ni - 1 : nor.length / 3 + ni;
      outNor.push(nor[nui * 3], nor[nui * 3 + 1], nor[nui * 3 + 2]);
      hasNormal = true;
    } else outNor.push(0, 0, 1);
    return base;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [cmd, ...rest] = line.split(/\s+/);
    if (cmd === 'v') pos.push(+rest[0], +rest[1], +rest[2]);
    else if (cmd === 'vt') uv.push(+rest[0], +rest[1]);
    else if (cmd === 'vn') nor.push(+rest[0], +rest[1], +rest[2]);
    else if (cmd === 'usemtl' && mtl?.has(rest[0])) currentColor = mtl.get(rest[0])!;
    else if (cmd === 'f') {
      const fan = rest.map(vert);
      for (let i = 1; i < fan.length - 1; i++) indices.push(fan[0], fan[i], fan[i + 1]);
    }
  }

  const vertexColors = new Uint32Array(outPos.length / 3);
  if (!textureImage) vertexColors.fill(currentColor);
  else {
    for (let i = 0; i < vertexColors.length; i++) {
      const u = outUv[i * 2], v = outUv[i * 2 + 1];
      const tx = Math.min(textureImage.width - 1, Math.max(0, Math.floor(u * textureImage.width)));
      const ty = Math.min(textureImage.height - 1, Math.max(0, Math.floor((1 - v) * textureImage.height)));
      const o = (ty * textureImage.width + tx) * 4;
      vertexColors[i] = rgba(textureImage.data[o], textureImage.data[o + 1], textureImage.data[o + 2]);
    }
  }

  return {
    positions: Float32Array.from(outPos),
    normals: hasNormal ? Float32Array.from(outNor) : undefined,
    uvs: Float32Array.from(outUv),
    vertexColors,
    indices: Uint32Array.from(indices),
    baseColor: currentColor,
    albedo: textureImage
      ? { width: textureImage.width, height: textureImage.height, data: textureImage.data }
      : undefined
  };
}

/** 极简 MTL 解析:只取 Kd 漫反射色 */
export function parseMTL(text: string): Map<string, number> {
  const map = new Map<string, number>();
  let name = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [cmd, ...r] = line.split(/\s+/);
    if (cmd === 'newmtl') name = r[0];
    else if (cmd === 'Kd') map.set(name, rgba(+r[0] * 255, +r[1] * 255, +r[2] * 255));
  }
  return map;
}

export function colorToCss(c: number): string {
  return `rgb(${r8(c)},${g8(c)},${b8(c)})`;
}
