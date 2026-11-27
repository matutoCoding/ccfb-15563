import { rgba } from './grid';
import type { TriangleMesh } from './mesh';

/**
 * glTF 2.0 解析(GLB 与内嵌 base64 的 .gltf)。
 * 支持:多 primitive 合并、POSITION/NORMAL/TEXCOORD_0、索引、baseColorFactor、
 * 单张 base64 贴图。外部 .bin/.png 引用在导入页预处理时读入并注入 external。
 */

interface GltfImage {
  uri?: string;
  bufferView?: number;
  mimeType?: string;
}

interface GltfJson {
  buffers?: Array<{ byteLength: number; uri?: string }>;
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number; target?: number }>;
  accessors?: Array<{ bufferView: number; componentType: number; count: number; type: string; byteOffset?: number }>;
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number; material?: number }> }>;
  materials?: Array<{ pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number } }; name?: string }>;
  textures?: Array<{ source: number }>;
  images?: GltfImage[];
}

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export interface GltfExternals {
  /** uri(文件名)→ ArrayBuffer */
  buffers?: Map<string, ArrayBuffer>;
  /** uri(文件名)→ ImageData */
  images?: Map<string, ImageData>;
}

export async function parseGLTF(input: ArrayBuffer | string, ext: GltfExternals = {}): Promise<TriangleMesh> {
  let json: GltfJson = {};
  let binChunks: ArrayBuffer[] = [];

  if (typeof input === 'string') {
    json = JSON.parse(input);
  } else {
    const view = new DataView(input);
    const magic = view.getUint32(0, true);
    if (magic !== 0x46546c67) throw new Error('不是有效的 GLB 文件');
    let offset = 12;
    while (offset < input.byteLength) {
      const len = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      const chunk = input.slice(offset + 8, offset + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
      else if (type === 0x004e4942) binChunks.push(chunk);
      offset += 8 + len;
    }
  }

  const bufferData = (json.buffers ?? []).map((b, i) => {
    if (binChunks[i]) return binChunks[i];
    if (b.uri?.startsWith('data:')) {
      const b64 = b.uri.split(',')[1];
      return base64ToBuffer(b64);
    }
    if (b.uri && ext.buffers?.has(b.uri)) return ext.buffers.get(b.uri)!;
    throw new Error(`缺少外部缓冲: ${b.uri ?? '#' + i}(请把相关 .bin 一起导入)`);
  });

  const readAccessor = (accessorIndex: number): { data: number[]; comps: number } => {
    const acc = json.accessors![accessorIndex];
    const bv = json.bufferViews![acc.bufferView];
    const compBytes = COMPONENT_BYTES[acc.componentType];
    const comps = TYPE_COMPONENTS[acc.type];
    const stride = bv.byteLength / acc.count;
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const buf = bufferData[bv.buffer];
    const dv = new DataView(buf);
    const data: number[] = [];
    for (let i = 0; i < acc.count; i++) {
      const o = base + i * stride;
      for (let c = 0; c < comps; c++) {
        const co = o + c * compBytes;
        switch (acc.componentType) {
          case 5120: data.push(dv.getInt8(co)); break;
          case 5121: data.push(dv.getUint8(co)); break;
          case 5122: data.push(dv.getInt16(co, true)); break;
          case 5123: data.push(dv.getUint16(co, true)); break;
          case 5125: data.push(dv.getUint32(co, true)); break;
          default: data.push(dv.getFloat32(co, true));
        }
      }
    }
    return { data, comps };
  };

  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const colors: number[] = [];
  let vertexOffset = 0;

  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      const pos = readAccessor(prim.attributes.POSITION).data;
      const nor = prim.attributes.NORMAL !== undefined ? readAccessor(prim.attributes.NORMAL).data : null;
      const uv = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(prim.attributes.TEXCOORD_0).data : null;
      let primIdx: number[];
      if (prim.indices !== undefined) primIdx = readAccessor(prim.indices).data;
      else primIdx = pos.map((_, i) => i / 3).filter((_, i) => i % 3 === 0).map((_, i) => i);

      const mat = prim.material !== undefined ? json.materials?.[prim.material] : undefined;
      const factor = mat?.pbrMetallicRoughness?.baseColorFactor;
      const baseColor = factor
        ? rgba(factor[0] * 255, factor[1] * 255, factor[2] * 255, (factor[3] ?? 1) * 255)
        : rgba(205, 205, 205);
      let image: ImageData | undefined;
      const texIdx = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
      if (texIdx !== undefined) {
        const src = json.textures?.[texIdx]?.source;
        if (src !== undefined) image = await resolveImage(json.images?.[src], json, bufferData, ext);
      }

      for (let i = 0; i < pos.length; i += 3) {
        positions.push(pos[i], pos[i + 1], pos[i + 2]);
        normals.push(nor ? nor[i] : 0, nor ? nor[i + 1] : 0, nor ? nor[i + 2] : 1);
        uvs.push(uv ? uv[(i / 3) * 2] : 0, uv ? uv[(i / 3) * 2 + 1] : 0);
        let col = baseColor;
        if (image) {
          const u = uvs[uvs.length - 2], v = uvs[uvs.length - 1];
          const tx = Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width)));
          const ty = Math.min(image.height - 1, Math.max(0, Math.floor((1 - v) * image.height)));
          const o = (ty * image.width + tx) * 4;
          col = rgba(image.data[o], image.data[o + 1], image.data[o + 2], image.data[o + 3]);
        }
        colors.push(col);
      }
      for (const id of primIdx) indices.push(id + vertexOffset);
      vertexOffset += pos.length / 3;
    }
  }

  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    vertexColors: Uint32Array.from(colors),
    indices: Uint32Array.from(indices),
    baseColor: rgba(205, 205, 205)
  };
}

async function resolveImage(
  img: GltfImage | undefined,
  json: GltfJson,
  buffers: ArrayBuffer[],
  ext: GltfExternals
): Promise<ImageData | undefined> {
  if (!img) return undefined;
  let blob: Blob;
  if (img.bufferView !== undefined) {
    const bv = json.bufferViews![img.bufferView];
    blob = new Blob([buffers[bv.buffer].slice(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)],
      { type: img.mimeType ?? 'image/png' });
  } else if (img.uri?.startsWith('data:')) {
    blob = await (await fetch(img.uri)).blob();
  } else if (img.uri && ext.images?.has(img.uri)) {
    return ext.images.get(img.uri);
  } else return undefined;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
