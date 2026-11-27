import type { Order, Project, SerializedProject, SerializedVoxelGrid } from '../types';
import { b64FromBytes, bytesFromB64, int32FromBase64, int32ToBase64, uid } from './utils';
import { defaultSettings } from './pipeline';

export function createProject(orderId: string, name: string, sourceKind: Project['sourceKind'] = 'project'): Project {
  const now = Date.now();
  return {
    id: uid('proj'),
    orderId,
    name,
    sourceKind,
    createdAt: now,
    updatedAt: now,
    settings: defaultSettings(),
    paletteOverrides: {},
    grid: null,
    bricks: [],
    issues: [],
    partCounts: [],
    stats: null,
  };
}

export function createOrder(input?: Partial<Order>): Order {
  const now = Date.now();
  const n = Math.floor(1000 + Math.random() * 9000);
  return {
    id: uid('order'),
    code: `BF-${new Date().getFullYear()}-${n}`,
    customer: '',
    petName: '',
    title: '新颗粒积木摆件',
    status: '新订单',
    dueDate: new Date(now + 7 * 86400000).toISOString().slice(0, 10),
    quantity: 1,
    budget: 800,
    note: '',
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function serializeGrid(project: Project): SerializedVoxelGrid | null {
  const g = project.grid;
  if (!g) return null;
  return {
    version: 1,
    nx: g.nx,
    ny: g.ny,
    nz: g.nz,
    kindB64: b64FromBytes(g.kind),
    colorB64: b64FromBytes(g.color),
    sourceRGBB64: int32ToBase64(g.sourceRGB),
  };
}

export function serializeProject(project: Project): SerializedProject {
  const { grid, ...rest } = project;
  return {
    ...rest,
    app: 'brickforge',
    formatVersion: 1,
    grid: serializeGrid(project),
  };
}

export function projectToJson(project: Project): string {
  return JSON.stringify(serializeProject(project));
}

export function deserializeProject(data: unknown): Project {
  if (!data || typeof data !== 'object') throw new Error('工程文件格式不正确');
  const d = data as SerializedProject;
  if (d.app !== 'brickforge' || d.formatVersion !== 1) {
    // Still accept plain project-like JSON where possible.
    if (!('settings' in d) || !('bricks' in d)) throw new Error('不是 BrickForge 工程文件');
  }
  let grid: Project['grid'] = null;
  if (d.grid) {
    const sg = d.grid;
    grid = {
      version: 1,
      nx: sg.nx,
      ny: sg.ny,
      nz: sg.nz,
      kind: bytesFromB64(sg.kindB64),
      color: bytesFromB64(sg.colorB64),
      sourceRGB: int32FromBase64(sg.sourceRGBB64),
    };
  }
  const { grid: _sg, app: _app, formatVersion: _v, ...rest } = d as SerializedProject;
  return {
    ...(rest as Omit<Project, 'grid'>),
    settings: { ...defaultSettings(), ...(rest.settings ?? {}) },
    paletteOverrides: rest.paletteOverrides ?? {},
    bricks: rest.bricks ?? [],
    issues: rest.issues ?? [],
    partCounts: rest.partCounts ?? [],
    stats: rest.stats ?? null,
    grid,
  };
}

export function parseProjectJson(text: string): Project {
  return deserializeProject(JSON.parse(text));
}
