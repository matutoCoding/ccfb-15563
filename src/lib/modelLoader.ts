import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import type { LoadedModelSource } from '../types';

interface PixelTexture {
  rgba: Uint8Array;
  width: number;
  height: number;
  flipY: boolean;
  repeatS: number;
  repeatT: number;
}

function baseName(name: string): string {
  return name.split(/[\\/]/).pop()?.toLowerCase() ?? name.toLowerCase();
}

async function extractTexture(texture: THREE.Texture | null | undefined): Promise<PixelTexture | null> {
  if (!texture?.image) return null;
  const img = texture.image as HTMLImageElement & { width?: number; height?: number };

  // MTL texture loads can still be in flight when parse() returns. Wait briefly
  // instead of silently falling back to flat material colors.
  if (img instanceof HTMLImageElement && !img.complete) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, 4000);
    });
  }
  if (img instanceof HTMLImageElement && typeof img.decode === 'function') {
    await img.decode().catch(() => undefined);
  }

  const anyImg = img as unknown as { naturalWidth?: number; naturalHeight?: number; displayWidth?: number; displayHeight?: number; width?: number; height?: number };
  const width = anyImg.naturalWidth || anyImg.width || anyImg.displayWidth || 0;
  const height = anyImg.naturalHeight || anyImg.height || anyImg.displayHeight || 0;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  return {
    rgba: new Uint8Array(data.buffer),
    width,
    height,
    flipY: texture.flipY,
    repeatS: texture.repeat?.x ?? 1,
    repeatT: texture.repeat?.y ?? 1,
  };
}

function wrapCoord(u: number, repeat: number, wrapping: THREE.Wrapping): number {
  let x = u * repeat;
  if (wrapping === THREE.RepeatWrapping) {
    x = x - Math.floor(x);
  } else if (wrapping === THREE.MirroredRepeatWrapping) {
    const m = x % 2;
    x = m < 0 ? m + 2 : m;
    x = x > 1 ? 2 - x : x;
  } else {
    x = Math.min(1, Math.max(0, x));
  }
  return x;
}

function sampleTexture(t: PixelTexture, u: number, v: number): [number, number, number] {
  let uu = wrapCoord(u, t.repeatS, THREE.RepeatWrapping);
  let vv = wrapCoord(v, t.repeatT, THREE.RepeatWrapping);
  if (t.flipY) vv = 1 - vv;
  const x = Math.min(t.width - 1, Math.max(0, Math.floor(uu * t.width)));
  const y = Math.min(t.height - 1, Math.max(0, Math.floor(vv * t.height)));
  const i = (y * t.width + x) * 4;
  return [t.rgba[i], t.rgba[i + 1], t.rgba[i + 2]];
}

function materialList(m: THREE.Material | THREE.Material[] | undefined): THREE.Material[] {
  if (!m) return [];
  return Array.isArray(m) ? m : [m];
}

async function bakeMaterial(material: THREE.Material): Promise<{
  color: THREE.Color;
  map: PixelTexture | null;
  threeMap?: THREE.Texture | null;
}> {
  const anyMat = material as THREE.MeshStandardMaterial;
  const map = await extractTexture(anyMat.map ?? null);
  return {
    color: anyMat.color ? anyMat.color.clone() : new THREE.Color(0xcccccc),
    map,
    threeMap: anyMat.map,
  };
}

/** Flatten loaded meshes and bake texture/material color into triangle vertices. */
async function flattenRoot(root: THREE.Object3D, fileName: string): Promise<LoadedModelSource> {
  root.updateMatrixWorld(true);

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const textureNames = new Set<string>();
  let meshCount = 0;
  let firstTexture: LoadedModelSource['texture'];

  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry) meshes.push(o);
  });

  for (const mesh of meshes) {
    meshCount++;
    let geometry = mesh.geometry;
    const hadIndex = geometry.index !== null;
    if (hadIndex) geometry = geometry.toNonIndexed();
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) continue;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const vertexColor = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    const mats = materialList(mesh.material);
    const baked = await Promise.all(mats.map(bakeMaterial));
    baked.forEach((b, i) => {
      const map = b.threeMap;
      if (map?.name) textureNames.add(map.name);
      else if ((mats[i] as THREE.MeshStandardMaterial)?.map?.image?.src) {
        const src = String((mats[i] as THREE.MeshStandardMaterial).map!.image.src);
        if (src.startsWith('blob:')) textureNames.add(baseName(src));
      }
      if (b.map && !firstTexture) {
        firstTexture = { width: b.map.width, height: b.map.height, rgba: b.map.rgba, name: map?.name };
      }
    });

    const startVertex = positions.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z);
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
      else uvs.push(0, 0);

      let r = 205;
      let g = 205;
      let b = 205;
      let matIndex = 0;
      if (geometry.groups.length) {
        const group = geometry.groups.find((gr) => i >= gr.start && i < gr.start + gr.count);
        if (group?.materialIndex != null) matIndex = group.materialIndex;
      }
      const bm = baked[Math.min(matIndex, baked.length - 1)];
      if (bm) {
        r = Math.round(bm.color.r * 255);
        g = Math.round(bm.color.g * 255);
        b = Math.round(bm.color.b * 255);
        if (bm.map && uv) {
          const [tr, tg, tb] = sampleTexture(bm.map, uv.getX(i), uv.getY(i));
          r = Math.round((r / 255) * tr);
          g = Math.round((g / 255) * tg);
          b = Math.round((b / 255) * tb);
        }
      }
      if (vertexColor) {
        r = Math.round(r * vertexColor.getX(i));
        g = Math.round(g * vertexColor.getY(i));
        b = Math.round(b * vertexColor.getZ(i));
      }
      colors.push(r, g, b);
      indices.push(startVertex + i);
    }

    if (normal) {
      // Normals are currently only used by optional previews; keep parsing explicit.
      void normal;
    }
    if (hadIndex && geometry !== mesh.geometry) geometry.dispose();
  }

  if (!positions.length) throw new Error('文件中没有可转换的三角网格');

  return {
    kind: fileName.toLowerCase().endsWith('.obj') ? 'obj' : 'gltf',
    fileName,
    triangleCount: indices.length / 3,
    meshCount,
    textureNames: [...textureNames],
    positions: new Float32Array(positions),
    normals: new Float32Array((positions.length / 3) * 3),
    uvs: new Float32Array(uvs),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
    texture: firstTexture,
  };
}

function makeFileManager(files: File[]): { manager: THREE.LoadingManager; urls: Map<string, string> } {
  const urls = new Map<string, string>();
  for (const f of files) {
    const url = URL.createObjectURL(f);
    urls.set(baseName(f.name), url);
    urls.set(f.name.toLowerCase(), url);
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier?.((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    const clean = url.split('?')[0].split('#')[0];
    const hit = urls.get(baseName(clean));
    return hit ?? url;
  });
  return { manager, urls };
}

export async function loadModelFiles(fileList: File[] | FileList): Promise<LoadedModelSource> {
  const files = [...fileList];
  if (!files.length) throw new Error('请选择 OBJ、glTF 或 GLB 文件');
  const root =
    files.find((f) => /\.(glb|gltf)$/i.test(f.name)) ??
    files.find((f) => /\.obj$/i.test(f.name));
  if (!root) throw new Error('仅支持 .obj、.gltf 和 .glb 模型');

  const { manager, urls } = makeFileManager(files);
  let object: THREE.Object3D;

  try {
    if (/\.glb$/i.test(root.name)) {
      const buffer = await root.arrayBuffer();
      const gltf = await new GLTFLoader(manager).parseAsync(buffer, '');
      object = gltf.scene;
    } else if (/\.gltf$/i.test(root.name)) {
      const text = await root.text();
      let json = JSON.parse(text) as {
        buffers?: Array<{ uri?: string }>;
        images?: Array<{ uri?: string }>;
      };
      // Rewrite relative resources to the user-selected blob files.
      json.buffers?.forEach((buf) => {
        if (buf.uri && !/^(data:|blob:|https?:)/.test(buf.uri)) {
          buf.uri = urls.get(baseName(buf.uri)) ?? buf.uri;
        }
      });
      json.images?.forEach((img) => {
        if (img.uri && !/^(data:|blob:|https?:)/.test(img.uri)) {
          img.uri = urls.get(baseName(img.uri)) ?? img.uri;
        }
      });
      const gltf = await new GLTFLoader(manager).parseAsync(JSON.stringify(json), '');
      object = gltf.scene;
    } else {
      const objText = await root.text();
      const mtlFile = files.find((f) => /\.mtl$/i.test(f.name));
      if (mtlFile) {
        const mtlText = await mtlFile.text();
        const mtlLoader = new MTLLoader(manager);
        const materials = mtlLoader.parse(mtlText, '');
        materials.preload();
        const loader = new OBJLoader(manager).setMaterials(materials);
        object = loader.parse(objText);
      } else {
        object = new OBJLoader(manager).parse(objText);
      }
    }
    return await flattenRoot(object, root.name);
  } finally {
    // Defer revocation until decoded images have been painted.
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 10_000);
  }
}
