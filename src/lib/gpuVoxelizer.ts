import type { LoadedModelSource } from '../types';
import { computeVoxelBounds, createSeedArrays, type SeedVoxels } from './voxelizer';

export function webgpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
}

const SHADER = /* wgsl */ `
struct Tri {
  p0: vec4f,
  p1: vec4f,
  p2: vec4f,
  c0: vec4f,
  c1: vec4f,
  c2: vec4f,
};

struct Params {
  grid: vec4u,
  minB: vec4f,
  extra: vec4f,
};

struct Cell {
  alive: atomic<u32>,
  r: atomic<u32>,
  g: atomic<u32>,
  b: atomic<u32>,
  count: atomic<u32>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> tris: array<Tri>;
@group(0) @binding(2) var<storage, read_write> cells: array<Cell>;

fn sub(a: vec3f, b: vec3f) -> vec3f { return a - b; }

fn closestPointOnTriangle(p: vec3f, a: vec3f, b: vec3f, c: vec3f) -> vec3f {
  let ab = b - a;
  let ac = c - a;
  let ap = p - a;
  let d1 = dot(ab, ap);
  let d2 = dot(ac, ap);
  if (d1 <= 0.0 && d2 <= 0.0) { return a; }

  let bp = p - b;
  let d3 = dot(ab, bp);
  let d4 = dot(ac, bp);
  if (d3 >= 0.0 && d4 <= d3) { return b; }

  let vc = d1 * d4 - d3 * d2;
  if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
    let v = d1 / (d1 - d3);
    return a + ab * v;
  }

  let cp = p - c;
  let d5 = dot(ab, cp);
  let d6 = dot(ac, cp);
  if (d6 >= 0.0 && d5 <= d6) { return c; }

  let vb = d5 * d2 - d1 * d6;
  if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
    let w = d2 / (d2 - d6);
    return a + ac * w;
  }

  let va = d3 * d6 - d5 * d4;
  if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
    let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return b + (c - b) * w;
  }

  let denom = 1.0 / (va + vb + vc);
  let v = vb * denom;
  let w = vc * denom;
  return a + ab * v + ac * w;
}

@compute @workgroup_size(64)
fn voxelize(@builtin(global_invocation_id) gid: vec3u) {
  let triangleIndex = gid.x;
  let triangleCount = params.grid.w;
  if (triangleIndex >= triangleCount) { return; }

  let t = tris[triangleIndex];
  let p0 = t.p0.xyz;
  let p1 = t.p1.xyz;
  let p2 = t.p2.xyz;
  let lo = min(min(p0, p1), p2);
  let hi = max(max(p0, p1), p2);
  let voxel = params.minB.w;
  let bias = params.minB.xyz;

  var x0 = i32(floor((lo.x - bias.x) / voxel)) - 1;
  var y0 = i32(floor((lo.y - bias.y) / voxel)) - 1;
  var z0 = i32(floor((lo.z - bias.z) / voxel)) - 1;
  var x1 = i32(ceil((hi.x - bias.x) / voxel)) + 1;
  var y1 = i32(ceil((hi.y - bias.y) / voxel)) + 1;
  var z1 = i32(ceil((hi.z - bias.z) / voxel)) + 1;

  let nx = i32(params.grid.x);
  let ny = i32(params.grid.y);
  let nz = i32(params.grid.z);
  x0 = clamp(x0, 0, nx - 1);
  y0 = clamp(y0, 0, ny - 1);
  z0 = clamp(z0, 0, nz - 1);
  x1 = clamp(x1, 0, nx - 1);
  y1 = clamp(y1, 0, ny - 1);
  z1 = clamp(z1, 0, nz - 1);

  let radiusSq = params.extra.x;
  let col = (t.c0.rgb + t.c1.rgb + t.c2.rgb) / 3.0;

  for (var y = y0; y <= y1; y++) {
    for (var z = z0; z <= z1; z++) {
      for (var x = x0; x <= x1; x++) {
        let center = bias + vec3f((f32(x) + 0.5) * voxel,
                                  (f32(y) + 0.5) * voxel,
                                  (f32(z) + 0.5) * voxel);
        let q = closestPointOnTriangle(center, p0, p1, p2);
        let d = center - q;
        let d2 = dot(d, d);
        if (d2 <= radiusSq) {
          let index = u32(x) + params.grid.x * (u32(z) + params.grid.z * u32(y));
          atomicStore(&cells[index].alive, 1u);
          atomicAdd(&cells[index].r, u32(clamp(col.r * 255.0, 0.0, 255.0)));
          atomicAdd(&cells[index].g, u32(clamp(col.g * 255.0, 0.0, 255.0)));
          atomicAdd(&cells[index].b, u32(clamp(col.b * 255.0, 0.0, 255.0)));
          atomicAdd(&cells[index].count, 1u);
        }
      }
    }
  }
}
`;

export async function voxelizeGpu(
  source: LoadedModelSource,
  resolution: number,
): Promise<SeedVoxels> {
  if (!webgpuAvailable()) throw new Error('当前浏览器不支持 WebGPU');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('没有可用的 WebGPU 适配器');
  const device = await adapter.requestDevice();

  const started = performance.now();
  const bounds = computeVoxelBounds(source, resolution);
  const { nx, ny, nz, voxel, minX, minY, minZ } = bounds;
  const vertexCount = source.indices.length;
  const triangleCount = vertexCount / 3;
  if (!Number.isInteger(triangleCount)) throw new Error('索引不是三角形列表');

  // Six vec4 slots per triangle. Vertex color is stored straight from textures.
  const triData = new ArrayBuffer(triangleCount * 96);
  const f32 = new Float32Array(triData);
  const positions = source.positions;
  const colors = source.colors;
  const indices = source.indices;
  for (let t = 0; t < triangleCount; t++) {
    const base = t * 24;
    for (let corner = 0; corner < 3; corner++) {
      const vi = indices[t * 3 + corner] * 3;
      const slot = base + corner * 4;
      f32[slot] = positions[vi];
      f32[slot + 1] = positions[vi + 1];
      f32[slot + 2] = positions[vi + 2];
      f32[slot + 3] = 1;
      const colorSlot = base + 12 + corner * 4;
      f32[colorSlot] = colors[vi] / 255;
      f32[colorSlot + 1] = colors[vi + 1] / 255;
      f32[colorSlot + 2] = colors[vi + 2] / 255;
      f32[colorSlot + 3] = 1;
    }
  }

  const voxelCount = nx * ny * nz;
  const arrays = createSeedArrays(bounds);
  const cellByteSize = voxelCount * 5 * Uint32Array.BYTES_PER_ELEMENT;

  const triBuffer = device.createBuffer({
    size: triData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(triBuffer, 0, triData);

  const cellBuffer = device.createBuffer({
    size: cellByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const uniformData = new ArrayBuffer(48);
  const u32 = new Uint32Array(uniformData);
  u32[0] = nx;
  u32[1] = ny;
  u32[2] = nz;
  u32[3] = triangleCount;
  const uf32 = new Float32Array(uniformData);
  uf32[4] = minX;
  uf32[5] = minY;
  uf32[6] = minZ;
  uf32[7] = voxel;
  uf32[8] = (voxel * 0.82) ** 2;
  const uniformBuffer = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  const module = device.createShaderModule({ code: SHADER });
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module, entryPoint: 'voxelize' },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: triBuffer } },
      { binding: 2, resource: { buffer: cellBuffer } },
    ],
  });

  const readback = device.createBuffer({
    size: cellByteSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(triangleCount / 64));
  pass.end();
  encoder.copyBufferToBuffer(cellBuffer, 0, readback, 0, cellByteSize);
  device.queue.submit([encoder.finish()]);

  await readback.mapAsync(GPUMapMode.READ);
  const raw = new Uint32Array(readback.getMappedRange());
  for (let i = 0; i < voxelCount; i++) {
    const j = i * 5;
    if (raw[j]) arrays.seed[i] = 1;
    arrays.accR[i] = raw[j + 1];
    arrays.accG[i] = raw[j + 2];
    arrays.accB[i] = raw[j + 3];
    arrays.accN[i] = raw[j + 4];
  }
  readback.unmap();
  readback.destroy();
  cellBuffer.destroy();
  triBuffer.destroy();
  uniformBuffer.destroy();
  device.destroy();

  return {
    bounds,
    ...arrays,
    backend: 'webgpu',
    gpuMs: performance.now() - started,
  };
}
