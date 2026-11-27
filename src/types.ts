export type ID = string;

export type PageKey =
  | 'orders'
  | 'import'
  | 'voxel'
  | 'color'
  | 'instructions'
  | 'settings';

export type ModelSourceKind = 'cat' | 'house' | 'obj' | 'gltf' | 'project';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Runtime voxel grid. y is the vertical brick layer axis. */
export interface VoxelGrid {
  version: 1;
  nx: number;
  ny: number;
  nz: number;
  /** 0 = empty, 1 = final shell/material voxel, 2 = auto support voxel. */
  kind: Uint8Array;
  /** Quantized palette index, 255 when uncolored/empty. */
  color: Uint8Array;
  /** Average source sRGB color packed as 0xRRGGBB, -1 when unavailable. */
  sourceRGB: Int32Array;
}

export interface BrickType {
  id: string;
  name: string;
  w: number;
  d: number;
  /** Normal brick height expressed in stud-pitch units. */
  height: number;
  /** Common design number used in the CSV/PDF. */
  partNo: string;
}

export interface Brick {
  id: ID;
  typeId: string;
  w: number;
  d: number;
  /** Minimum grid coordinate; bricks are one layer high in this planner. */
  x: number;
  y: number;
  z: number;
  /** Palette id. Support bricks default to a dedicated support color id. */
  colorId: string;
  support?: boolean;
  auto?: boolean;
  /** Number of stud cells touching bricks in layer y-1. */
  lowerStuds?: number;
  /** Number of stud cells touching bricks in layer y+1. */
  upperStuds?: number;
}

export type IssueSeverity = 'error' | 'warning' | 'success';

export interface StabilityIssue {
  id: ID;
  brickId: ID;
  layer: number;
  kind: 'floating' | 'single-stud' | 'no-upper-bond' | 'thin-bridge';
  severity: IssueSeverity;
  message: string;
  studs?: number;
}

export interface ConvertSettings {
  /** Longest voxel-grid axis. */
  resolution: 48 | 64 | 80 | 96 | 128;
  hollow: boolean;
  /** Shell thickness in voxels/studs. Thin features are never fully eroded. */
  shellThickness: 1 | 2 | 3;
  /** Close sub-voxel gaps before flood filling. */
  repairThin: boolean;
  /** Brick types allowed during merging. */
  allowedTypeIds: string[];
  /** Add support columns until every brick has a lower bond. */
  autoSupport: boolean;
  /** Add a second clutch point to multi-stud bricks currently held by one stud. */
  reinforceSingleStuds: boolean;
  /** Replace out-of-stock colors with nearest in-stock palette entry. */
  autoReplaceOutOfStock: boolean;
  /** Prefer alternating orientation by layer. */
  staggerBonds: boolean;
}

export interface PaletteColor {
  id: string;
  name: string;
  hex: string;
  /** Default catalogue availability. Project overrides are stored separately. */
  inStock: boolean;
  /** Optional catalog group. */
  group: 'common' | 'earth' | 'bright' | 'neutral' | 'special';
}

export interface PaletteOverride {
  inStock?: boolean;
  locked?: boolean;
}

export interface Order {
  id: ID;
  code: string;
  customer: string;
  petName: string;
  title: string;
  status: '新订单' | '处理中' | '待确认' | '已完成';
  dueDate: string;
  quantity: number;
  budget: number;
  note: string;
  photoName?: string;
  photoDataUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PartCount {
  typeId: string;
  colorId: string;
  quantity: number;
  support?: boolean;
}

export interface BuildStats {
  sourceTriangles?: number;
  sourceMeshes?: number;
  voxelCount: number;
  shellVoxelCount: number;
  supportVoxelCount: number;
  brickCount: number;
  supportBrickCount: number;
  layerCount: number;
  partTypeCount: number;
  colorCount: number;
  floatingCount: number;
  singleStudCount: number;
  gpuVoxelMs?: number;
  colorMs?: number;
  mergeMs?: number;
  supportMs?: number;
  totalMs?: number;
  webgpu: boolean;
}

export interface Project {
  id: ID;
  orderId: ID;
  name: string;
  sourceKind: ModelSourceKind;
  sourceFileName?: string;
  sourceTextureNames?: string[];
  createdAt: number;
  updatedAt: number;
  settings: ConvertSettings;
  paletteOverrides: Record<string, PaletteOverride>;
  grid: VoxelGrid | null;
  bricks: Brick[];
  issues: StabilityIssue[];
  partCounts: PartCount[];
  stats: BuildStats | null;
}

export interface SerializedVoxelGrid {
  version: 1;
  nx: number;
  ny: number;
  nz: number;
  kindB64: string;
  colorB64: string;
  sourceRGBB64: string;
}

export interface SerializedProject extends Omit<Project, 'grid'> {
  app: 'brickforge';
  formatVersion: 1;
  grid: SerializedVoxelGrid | null;
}

export interface LoadedModelSource {
  kind: 'obj' | 'gltf';
  fileName: string;
  triangleCount: number;
  meshCount: number;
  textureNames: string[];
  /** Tightly packed positions xyz. */
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Uint8Array;
  indices: Uint32Array;
  /** Raw texture pixels and dimensions, first diffuse/base-color texture. */
  texture?: {
    width: number;
    height: number;
    rgba: Uint8Array;
    name?: string;
  };
}
