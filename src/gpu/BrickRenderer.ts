import type { Brick, PaletteColor, Vec3 } from '../core/types';

/**
 * 自研 WebGPU 渲染器:
 * - 每种砖型一个凸点砖几何体,按砖实例化(instanced)
 * - WGSL Blinn-Phong + 菲涅尔高光模拟 ABS 塑料
 * - 轨道相机(左键旋转 / 滚轮缩放 / 右键平移),自动适配 DPR
 */

const WGSL = /* wgsl */ `
struct Camera { viewProj: mat4x4<f32>, eye: vec3<f32>, pad: f32 };
/* std140 对齐:全部 vec4,每实例 48 字节 = 12 个 f32,与 JS 端布局一致 */
struct Instance {
  offset: vec4<f32>,   // xyz 位置,w = 高亮
  scale: vec4<f32>,    // xy 砖尺寸,z 保留,w = 透明度
  color: vec4<f32>,    // rgb,a 保留
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(1) @binding(0) var<storage, read> instances: array<Instance>;

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) world: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) inst: u32,
};

@vertex
fn vs(@location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>,
      @builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let inst = instances[ii];
  let p = vec3<f32>(pos.x * inst.scale.x, pos.y * inst.scale.y, pos.z);
  let world = p + inst.offset;
  var out: VsOut;
  out.clip = cam.viewProj * vec4<f32>(world, 1.0);
  out.normal = normalize(normal);
  out.world = world;
  out.uv = uv;
  out.inst = ii;
  return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let inst = instances[in.inst];
  let n = normalize(in.normal);
  let l = normalize(vec3<f32>(0.5, 0.8, 1.0));
  let v = normalize(cam.eye - in.world);
  let h = normalize(l + v);
  let ambient = vec3<f32>(0.32);
  let diffuse = max(dot(n, l), 0.0) * vec3<f32>(0.85);
  // 塑料:窄而强的高光 + 菲涅尔边缘反射
  let spec = pow(max(dot(n, h), 0.0), 48.0) * vec3<f32>(0.9);
  let fres = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.25;
  let shade = ambient + diffuse + vec3<f32>(spec + fres);
  let base = inst.color.rgb * shade;
  let hl = vec3<f32>(1.0, 0.75, 0.2) * inst.offset.w;
  return vec4<f32>(base + hl, inst.scale.w);
}
`;

export interface RenderBrick {
  x: number; y: number; z: number;
  nx: number; ny: number;
  rgb: [number, number, number];
  highlight?: boolean;
  alpha?: number;
}

export class BrickRenderer {
  private ctx!: GPUCanvasContext;
  private device!: GPUDevice;
  private format!: GPUTextureFormat;
  private pipeline!: GPURenderPipeline;
  private camBuffer!: GPUBuffer;
  private camera = { yaw: 0.6, pitch: 0.5, dist: 0, target: [0, 0, 0] as [number, number, number] };
  private raf = 0;
  private disposed = false;
  private alpha = 1;
  private lastInstances: RenderBrick[] = [];
  private typeGeos = new Map<string, { vb: GPUBuffer; ib: GPUBuffer; count: number }>();
  /** 砖型 key → 可增长的实例缓冲,避免每帧重建造成显存抖动 */
  private instBuffers = new Map<string, { buf: GPUBuffer; cap: number }>();

  constructor(private canvas: HTMLCanvasElement) {
    if (!canvas.getContext) throw new Error('canvas 不可用');
  }

  static async create(canvas: HTMLCanvasElement): Promise<BrickRenderer> {
    if (!('gpu' in navigator)) throw new Error('当前浏览器不支持 WebGPU,请用 Chrome/Edge 113+');
    const adapter = await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter();
    if (!adapter) throw new Error('找不到 WebGPU GPU 适配器');
    const r = new BrickRenderer(canvas);
    r.device = await adapter.requestDevice();
    r.ctx = canvas.getContext('webgpu')!;
    r.format = (navigator as Navigator & { gpu: GPU }).gpu.getPreferredCanvasFormat();
    r.ctx.configure({ device: r.device, format: r.format, alphaMode: 'premultiplied' });
    r.initPipeline();
    r.camBuffer = r.device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    r.attachControls(canvas);
    r.loop();
    return r;
  }

  private initPipeline() {
    const module = this.device.createShaderModule({ code: WGSL });
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs', buffers: [{
        arrayStride: 32, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x2' }
        ]
      }] },
      fragment: { module, entryPoint: 'fs', targets: [{
        format: this.format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
        }
      }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
    });
  }

  /** 生成带凸点的砖几何:单位砖为 1x1,砖间留 0.04 装配缝 */
  private brickGeometry(nx: number, ny: number) {
    const key = `${nx}x${ny}`;
    const cached = this.typeGeos.get(key);
    if (cached) return cached;
    const gap = 0.02;
    const w = nx - gap * 2, d = ny - gap * 2, h = 0.92, studR = 0.28, studH = 0.16;
    const v: number[] = [];
    const idx: number[] = [];
    const addV = (p: [number, number, number], n: [number, number, number], uv: [number, number]) =>
      v.push(...p, ...n, ...uv);
    const addBox = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number) => {
      const base = v.length / 8;
      const cs: Array<[number, number, number]> = [
        [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz],
        [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
        [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz],
        [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz]
      ];
      const ns: Array<[number, number, number]> = [
        [0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]
      ];
      cs.forEach((c) => addV(c, [0, 0, 1], [0, 0]));
      const faces = [[0, 3, 2, 0, 2, 1], [4, 5, 6, 4, 6, 7], [0, 1, 5, 0, 5, 4],
        [2, 3, 7, 2, 7, 6], [0, 4, 7, 0, 7, 3], [1, 2, 6, 1, 6, 5]];
      faces.forEach((f, fi) => {
        for (const vi of f) {
          const gi = base + vi;
          v[gi * 8 + 3] = ns[fi][0]; v[gi * 8 + 4] = ns[fi][1]; v[gi * 8 + 5] = ns[fi][2];
          idx.push(gi);
        }
      });
    };
    addBox(0, 0, h / 2, w / 2, d / 2, h / 2);
    // 每个颗粒一个凸点(圆柱,12 段)
    for (let sx = 0; sx < nx; sx++) {
      for (let sy = 0; sy < ny; sy++) {
        const cx = sx - (nx - 1) / 2, cy = sy - (ny - 1) / 2;
        const seg = 12;
        const ringBase = v.length / 8;
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          const x = Math.cos(a) * studR, y = Math.sin(a) * studR;
          addV([cx + x, cy + y, h], [Math.cos(a), Math.sin(a), 0], [i / seg, 0]);
          addV([cx + x, cy + y, h + studH], [Math.cos(a), Math.sin(a), 0], [i / seg, 1]);
        }
        for (let i = 0; i < seg; i++) {
          const a = ringBase + i * 2, b = a + 1, c = ringBase + (i + 1) * 2, d2 = c + 1;
          idx.push(a, c, b, b, c, d2);
        }
        const topCenter = v.length / 8;
        addV([cx, cy, h + studH], [0, 0, 1], [0.5, 0.5]);
        const topRing = v.length / 8;
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          addV([cx + Math.cos(a) * studR, cy + Math.sin(a) * studR, h + studH], [0, 0, 1],
            [0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5]);
        }
        for (let i = 0; i < seg; i++) idx.push(topCenter, topRing + i, topRing + i + 1);
      }
    }
    const vb = this.device.createBuffer({ size: Math.ceil(v.length * 4 / 4) * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vb, 0, Float32Array.from(v));
    const ib = this.device.createBuffer({ size: idx.length * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(ib, 0, Uint32Array.from(idx));
    const geo = { vb, ib, count: idx.length };
    this.typeGeos.set(key, geo);
    return geo;
  }

  setBricks(bricks: RenderBrick[]) {
    this.lastInstances = bricks;
    if (!this.camera.dist) {
      const maxN = Math.max(1, ...bricks.map((b) => Math.max(b.nx, b.ny, b.z + 1)));
      this.camera.dist = maxN * 2.2 + 8;
    }
  }

  setAlpha(a: number) { this.alpha = a; }

  /** 仅在切换模型(尺寸变化)时调用一次,避免分步播放时相机被反复重置 */
  fitView(dims: Vec3) {
    this.camera.target = [dims.x / 2 - 0.5, dims.y / 2 - 0.5, dims.z / 2 - 0.5];
    this.camera.dist = Math.max(dims.x, dims.y, dims.z) * 1.8 + 4;
  }

  private attachControls(canvas: HTMLCanvasElement) {
    let drag = false, px = 0, py = 0, button = 0;
    canvas.addEventListener('pointerdown', (e) => {
      drag = true; px = e.clientX; py = e.clientY; button = e.button;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', () => { drag = false; });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      px = e.clientX; py = e.clientY;
      if (button === 2) {
        this.camera.target[0] -= dx * 0.02;
        this.camera.target[1] -= dy * 0.02;
      } else {
        this.camera.yaw += dx * 0.01;
        this.camera.pitch = Math.max(0.05, Math.min(1.5, this.camera.pitch + dy * 0.01));
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.dist = Math.max(3, this.camera.dist * (1 + Math.sign(e.deltaY) * 0.1));
    }, { passive: false });
  }

  private viewProj(): Float32Array {
    const { yaw, pitch, dist, target } = this.camera;
    const eye: [number, number, number] = [
      target[0] + dist * Math.cos(pitch) * Math.cos(yaw),
      target[1] + dist * Math.cos(pitch) * Math.sin(yaw),
      target[2] + dist * Math.sin(pitch)
    ];
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const fov = 45 * Math.PI / 180;
    const near = 0.1, far = 500;
    const f = 1 / Math.tan(fov / 2);
    const view = lookAt(eye, target, [0, 0, 1]);
    const proj = new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, far / (near - far), -1,
      0, 0, (far * near) / (near - far), 0
    ]);
    const vp = mul4(proj, view);
    const out = new Float32Array(20);
    out.set(vp, 0);
    out.set(eye, 16);
    return out;
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.render();
  };

  private render() {
    const canvas = this.canvas;
    const w = canvas.clientWidth * Math.min(devicePixelRatio, 2);
    const h = canvas.clientHeight * Math.min(devicePixelRatio, 2);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const depth = this.device.createTexture({
      size: [canvas.width, canvas.height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        clearValue: { r: 0.09, g: 0.1, b: 0.12, a: 1 },
        loadOp: 'clear', storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store'
      }
    });
    this.device.queue.writeBuffer(this.camBuffer, 0, this.viewProj());
    pass.setPipeline(this.pipeline);

    // 按砖型分组实例化
    const groups = new Map<string, RenderBrick[]>();
    for (const b of this.lastInstances) {
      const key = `${b.nx}x${b.ny}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(b);
    }
    for (const [key, list] of groups) {
      const [nx, ny] = key.split('x').map(Number);
      const geo = this.brickGeometry(nx, ny);
      const data = new Float32Array(list.length * 12);
      list.forEach((b, i) => {
        const o = i * 12;
        data[o] = b.x + b.nx / 2; data[o + 1] = b.y + b.ny / 2; data[o + 2] = b.z;
        data[o + 3] = b.highlight ? 1 : 0;
        data[o + 4] = b.nx; data[o + 5] = b.ny; data[o + 6] = 0;
        data[o + 7] = b.alpha ?? this.alpha;
        data[o + 8] = b.rgb[0] / 255; data[o + 9] = b.rgb[1] / 255; data[o + 10] = b.rgb[2] / 255;
        data[o + 11] = 0;
      });
      const byteLen = Math.max(data.byteLength, 48);
      let slot = this.instBuffers.get(key);
      if (!slot || slot.cap < byteLen) {
        slot?.buf.destroy();
        const cap = Math.max(byteLen, (slot?.cap ?? 0) * 2, 48);
        const buf = this.device.createBuffer({ size: cap, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        slot = { buf, cap };
        this.instBuffers.set(key, slot);
      }
      this.device.queue.writeBuffer(slot.buf, 0, data);
      const instBuf = slot.buf;
      const camBG = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.camBuffer } }]
      });
      const instBG = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: instBuf } }]
      });
      pass.setVertexBuffer(0, geo.vb);
      pass.setIndexBuffer(geo.ib, 'uint32');
      pass.setBindGroup(0, camBG);
      pass.setBindGroup(1, instBG);
      pass.drawIndexed(geo.count, list.length);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    depth.destroy();
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
  }
}

export function bricksToRender(bricks: Brick[], palette: PaletteColor[], highlightIds?: Set<number>): RenderBrick[] {
  const map = new Map(palette.map((c) => [c.id, c.rgb]));
  return bricks.map((b) => ({
    x: b.x, y: b.y, z: b.z, nx: b.nx, ny: b.ny,
    rgb: map.get(b.colorId) ?? [128, 128, 128],
    highlight: highlightIds?.has(b.id)
  }));
}

function lookAt(eye: number[], center: number[], up: number[]): Float32Array {
  const z = norm(sub(eye, center));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
  ]);
}
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]
];
const norm = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
      a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
