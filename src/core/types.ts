/**
 * 核心数据结构 —— 整个系统围绕这几个类型流转
 * 网格坐标约定:x/y 为水平面,z 为高度方向,单位均为"颗粒"(1x1 砖占 1x1x1)
 */

/** 网格中的体素,用扁平索引表示 */
export type VoxelIndex = number;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 体素化产出的稠密网格:颜色为 RGBA(0..255),solid 标记实心体素 */
export interface VoxelModel {
  dims: Vec3;
  /** 长度 dims.x*dims.y*dims.z,实心体素的颜色,空心为 null */
  colors: (number | null)[];
  /** 体素物理尺寸(毫米),用于导出与显示真实大小 */
  voxelSizeMm: number;
}

/** 实际存在的砖型定义(以颗粒为单位的底面尺寸),高度统一为 1 层 */
export interface BrickType {
  id: string;
  /** 底面 x 方向颗粒数 */
  nx: number;
  /** 底面 y 方向颗粒数 */
  ny: number;
  /** 显示名称,如 2x4 */
  name: string;
}

/** 已合入网格的一块砖 */
export interface Brick {
  id: number;
  typeId: string;
  /** 底面最小角网格坐标 */
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  /** 量化后的颗粒色卡颜色 id */
  colorId: string;
  /** 咬合的下层砖 id 列表(第 0 层为空,表示落地) */
  lowerContacts: number[];
  /** 咬合的上层砖 id 列表 */
  upperContacts: number[];
  /** 自动补的支撑砖标记(单独计入零件清单) */
  support?: boolean;
}

/** 稳定性分析结果 */
export interface StabilityIssue {
  kind: 'floating' | 'cantilever' | 'single-contact';
  brickId: number;
  /** 问题严重位置(世界/网格坐标),用于视图高亮 */
  at: Vec3;
  message: string;
}

export interface StabilityReport {
  issues: StabilityIssue[];
  /** 与下方砖(或地面)有咬合的体素占比 0..1 */
  interlockRatio: number;
  /** 无任何下层咬合的砖数(悬空) */
  floatingCount: number;
}

/** 图纸单步:某一层新放置的砖 */
export interface BuildStep {
  index: number;
  layer: number;
  brickIds: number[];
}

export interface BuildPlan {
  bricks: Brick[];
  steps: BuildStep[];
  report: StabilityReport;
}

/** 颗粒色卡条目 */
export interface PaletteColor {
  id: string;
  name: string;
  /** RGB 0..255 */
  rgb: [number, number, number];
  /** 是否缺货:量化时自动跳过,换最近色 */
  outOfStock?: boolean;
}

export interface ProjectSettings {
  /** 颗粒边长 mm */
  voxelSizeMm: number;
  /** 外壳最小厚度(颗粒数) */
  shellThickness: number;
  /** 体素化目标最长边分辨率 */
  targetResolution: number;
  /** 允许使用的砖型 id */
  enabledBrickTypes: string[];
  /** 自动补支撑 */
  autoSupport: boolean;
}
