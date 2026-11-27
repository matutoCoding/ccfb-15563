import type { TriangleMesh } from '../core/mesh';
import { fillInterior, type VoxelizeResult } from '../core/voxelize';

/**
 * WebGPU 计算着色器体素化。
 * 算法与 voxelize.ts 的 triBoxOverlap 逐行对应(Akenine-Möller SAT),
 * 一个 workgroup 处理一个三角形,组内线程并行扫描该三角形 AABB 覆盖的格子。
 * 写入用原子操作:标记用 atomicMin,颜色用 first-writer-wins CAS。
 */

const WGSL = /* wgsl */ `
struct Params {
  dims: vec3<u32>,
  triCount: u32,
  origin: vec3<f32>,
  spacing: f32,
  half: f32,
  layerSize: u32,
  volume: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read> triColors: array<u32>;
@group(0) @binding(4) var<storage, read_write> marks: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> cellColors: array<atomic<u32>>;

fn sat(boxHalf: f32, ax: f32, ay: f32, az: f32,
       p0: f32, p1: f32, p2: f32) -> bool {
  let mn = min(min(p0, p1), p2);
  let mx = max(max(p0, p1), p2);
  // 与 CPU 端相同的浮点容差,保证精确共面格子不被错误分离
  let r = boxHalf * (abs(ax) + abs(ay) + abs(az)) * 1.0000001;
  return max(-mx, mn) <= r;
}

fn overlap(h: f32, v0: vec3<f32>, v1: vec3<f32>, v2: vec3<f32>) -> bool {
  let e0 = v1 - v0;
  let e1 = v2 - v1;
  let e2 = v0 - v2;
  var ok = true;
  let axes = array<vec3<f32>, 9>(
    vec3<f32>(e0.y, -e0.x, 0.0), vec3<f32>(e0.z, 0.0, -e0.x), vec3<f32>(0.0, e0.z, -e0.y),
    vec3<f32>(e1.y, -e1.x, 0.0), vec3<f32>(e1.z, 0.0, -e1.x), vec3<f32>(0.0, e1.z, -e1.y),
    vec3<f32>(e2.y, -e2.x, 0.0), vec3<f32>(e2.z, 0.0, -e2.x), vec3<f32>(0.0, e2.z, -e2.y)
  );
  for (var i = i32(0); i < 9; i++) {
    let a = axes[i];
    let p0 = dot(a, v0); let p1 = dot(a, v1); let p2 = dot(a, v2);
    ok = ok && sat(h, a.x, a.y, a.z, p0, p1, p2);
  }
  // 盒子三个轴(与 CPU 端同一容差)
  let hb = h * 1.0000001;
  ok = ok && max(v0.x, max(v1.x, v2.x)) >= -hb && min(v0.x, min(v1.x, v2.x)) <= hb;
  ok = ok && max(v0.y, max(v1.y, v2.y)) >= -hb && min(v0.y, min(v1.y, v2.y)) <= hb;
  ok = ok && max(v0.z, max(v1.z, v2.z)) >= -hb && min(v0.z, min(v1.z, v2.z)) <= hb;
  // 面法线轴
  let n = cross(e0, e1);
  let q0 = dot(n, v0); let q1 = dot(n, v1); let q2 = dot(n, v2);
  ok = ok && sat(h, n.x, n.y, n.z, q0, q1, q2);
  return ok;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let tri = gid.y;
  if (tri >= params.triCount) { return; }
  var lane = gid.x;
  let i0 = indices[tri * 3u] * 3u;
  let i1 = indices[tri * 3u + 1u] * 3u;
  let i2 = indices[tri * 3u + 2u] * 3u;
  let a = vec3<f32>(positions[i0], positions[i0+1u], positions[i0+2u]);
  let b = vec3<f32>(positions[i1], positions[i1+1u], positions[i1+2u]);
  let c = vec3<f32>(positions[i2], positions[i2+1u], positions[i2+2u]);

  let lo = min(a, min(b, c));
  let hi = max(a, max(b, c));
  let dimsMax = params.dims - vec3<u32>(1u);
  var cell0 = vec3<u32>(
    clamp(u32(floor((lo.x - params.origin.x) / params.spacing)), 0u, dimsMax.x),
    clamp(u32(floor((lo.y - params.origin.y) / params.spacing)), 0u, dimsMax.y),
    clamp(u32(floor((lo.z - params.origin.z) / params.spacing)), 0u, dimsMax.z)
  );
  var cell1 = vec3<u32>(
    clamp(u32(floor((hi.x - params.origin.x) / params.spacing)), 0u, dimsMax.x),
    clamp(u32(floor((hi.y - params.origin.y) / params.spacing)), 0u, dimsMax.y),
    clamp(u32(floor((hi.z - params.origin.z) / params.spacing)), 0u, dimsMax.z)
  );
  let sx = cell1.x - cell0.x + 1u;
  let sy = cell1.y - cell0.y + 1u;
  let total = sx * sy * (cell1.z - cell0.z + 1u);

  // 线程跨步循环:一个三角形覆盖的格子可能远多于 256
  while (lane < total) {
    var s = lane;
    let ox = s % sx; s = s / sx;
    let oy = s % sy;
    let oz = s / sy;
    let gx = cell0.x + ox; let gy = cell0.y + oy; let gz = cell0.z + oz;

    let center = params.origin + (vec3<f32>(f32(gx), f32(gy), f32(gz)) + vec3<f32>(0.5)) * params.spacing;
    if (overlap(params.half, a - center, b - center, c - center)) {
      let vi = gx + params.dims.x * (gy + params.dims.y * gz);
      atomicMin(&marks[vi], 1u);
      let col = triColors[tri];
      atomicCompareExchangeWeak(&cellColors[vi], 0u, col);
    }
    lane += 256u;
  }
}
`;

export interface GpuVoxelizer {
  voxelize: (mesh: TriangleMesh, resolution: number) => Promise<VoxelizeResult | null>;
  destroy: () => void;
}

export async function createGpuVoxelizer(): Promise<GpuVoxelizer | null> {
  if (!('gpu' in navigator)) return null;
  const adapter = await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' }
  });

  async function voxelize(mesh: TriangleMesh, resolution: number): Promise<VoxelizeResult | null> {
    try {
      const padding = 1;
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      const p = mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        mnx = Math.min(mnx, p[i]); mny = Math.min(mny, p[i + 1]); mnz = Math.min(mnz, p[i + 2]);
        mxx = Math.max(mxx, p[i]); mxy = Math.max(mxy, p[i + 1]); mxz = Math.max(mxz, p[i + 2]);
      }
      const span = Math.max(mxx - mnx, mxy - mny, mxz - mnz) || 1;
      const spacing = span / resolution;
      const dims = {
        x: Math.ceil((mxx - mnx) / spacing) + padding * 2,
        y: Math.ceil((mxy - mny) / spacing) + padding * 2,
        z: Math.ceil((mxz - mnz) / spacing) + padding * 2
      };
      const volume = dims.x * dims.y * dims.z;
      const origin = { x: mnx - padding * spacing, y: mny - padding * spacing, z: mnz - padding * spacing };

      // 每三角形颜色(与 CPU 端同样的顶点/贴图取色逻辑,在传入前预算好)
      const triColors = new Uint32Array(mesh.indices.length / 3);
      for (let t = 0; t < triColors.length; t++) {
        triColors[t] = triColor(mesh, mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]);
      }

      const posBuf = device.createBuffer({ size: pad4(mesh.positions.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const idxBuf = device.createBuffer({ size: pad4(mesh.indices.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const colBuf = device.createBuffer({ size: pad4(triColors.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const markBuf = device.createBuffer({ size: volume * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
      const cellColBuf = device.createBuffer({ size: volume * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const paramsData = new ArrayBuffer(48);
      const dv = new DataView(paramsData);
      dv.setUint32(0, dims.x, true); dv.setUint32(4, dims.y, true); dv.setUint32(8, dims.z, true);
      dv.setUint32(12, triColors.length, true);
      dv.setFloat32(16, origin.x, true); dv.setFloat32(20, origin.y, true); dv.setFloat32(24, origin.z, true);
      dv.setFloat32(28, spacing, true); dv.setFloat32(32, spacing / 2, true);
      dv.setUint32(36, dims.x * dims.y, true); dv.setUint32(40, volume, true);
      const paramBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const markInit = new Uint32Array(volume).fill(0xffffffff);
      device.queue.writeBuffer(posBuf, 0, mesh.positions);
      device.queue.writeBuffer(idxBuf, 0, mesh.indices);
      device.queue.writeBuffer(colBuf, 0, triColors);
      device.queue.writeBuffer(markBuf, 0, markInit);
      device.queue.writeBuffer(paramBuf, 0, paramsData);

      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: paramBuf } },
          { binding: 1, resource: { buffer: posBuf } },
          { binding: 2, resource: { buffer: idxBuf } },
          { binding: 3, resource: { buffer: colBuf } },
          { binding: 4, resource: { buffer: markBuf } },
          { binding: 5, resource: { buffer: cellColBuf } }
        ]
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      // 每三角形一个 workgroup(256 线程),覆盖格数更多时着色器内跨步循环
      pass.dispatchWorkgroups(1, triColors.length);
      pass.end();

      const markRead = device.createBuffer({ size: volume * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const colRead = device.createBuffer({ size: volume * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      encoder.copyBufferToBuffer(markBuf, 0, markRead, 0, volume * 4);
      encoder.copyBufferToBuffer(cellColBuf, 0, colRead, 0, volume * 4);
      device.queue.submit([encoder.finish()]);
      await Promise.all([markRead.mapAsync(GPUMapMode.READ), colRead.mapAsync(GPUMapMode.READ)]);
      const markRaw = new Uint32Array(markRead.getMappedRange().slice(0));
      const colRaw = new Uint32Array(colRead.getMappedRange().slice(0));
      markRead.unmap(); colRead.unmap();

      const mask = new Uint8Array(volume);
      const colors = new Uint32Array(volume);
      for (let i = 0; i < volume; i++) {
        if (markRaw[i] === 1) { mask[i] = 1; colors[i] = colRaw[i] || 0xffaaaaaa; }
      }
      // 与 CPU 路径相同的后处理:泛洪填内腔
      fillInterior(mask, dims);
      for (const b of [posBuf, idxBuf, colBuf, markBuf, cellColBuf, paramBuf, markRead, colRead]) b.destroy();
      return { dims, origin, spacing, mask, colors, voxelSizeMm: spacing };
    } catch (err) {
      console.warn('GPU 体素化失败,回退 CPU:', err);
      return null;
    }
  }

  return {
    voxelize,
    destroy: () => device.destroy()
  };
}

function pad4(n: number): number {
  return Math.ceil(n / 4) * 4;
}

function triColor(mesh: TriangleMesh, ia: number, ib: number, ic: number): number {
  if (mesh.vertexColors) {
    let r = 0, g = 0, b = 0;
    for (const vi of [ia, ib, ic]) {
      const c = mesh.vertexColors[vi];
      r += c & 255; g += (c >> 8) & 255; b += (c >> 16) & 255;
    }
    return (255 << 24) | ((b / 3) << 16) | ((g / 3) << 8) | (r / 3);
  }
  return 0xffaaaaaa;
}
