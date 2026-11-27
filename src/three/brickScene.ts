import * as THREE from 'three';
import type { Brick } from '../types';
import { PALETTE_MAP } from '../lib/palette';

export const LAYER_H = 1.2;
const BODY_GAP = 0.055;

export interface BrickGroupOptions {
  opacity?: number;
  /** Render only these bricks. */
  ids?: Set<string>;
  /** Override all colors, useful for ghost/reference layers. */
  forceColor?: number;
  /** Draw studs even when covered by another rendered brick. */
  allStuds?: boolean;
}

export function brickColorHex(b: Brick): string {
  return PALETTE_MAP[b.colorId]?.hex ?? '#a3a2a4';
}

export function createBrickGroup(bricks: Brick[], options: BrickGroupOptions = {}): THREE.Group {
  const group = new THREE.Group();
  const selected = options.ids ? bricks.filter((b) => options.ids!.has(b.id)) : bricks;
  if (!selected.length) return group;

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: false,
    roughness: 0.28,
    metalness: 0,
    clearcoat: 0.72,
    clearcoatRoughness: 0.22,
    transparent: (options.opacity ?? 1) < 1,
    opacity: options.opacity ?? 1,
    depthWrite: (options.opacity ?? 1) >= 0.98,
  });

  const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
  const bodies = new THREE.InstancedMesh(bodyGeo, mat, selected.length);
  bodies.castShadow = true;
  bodies.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  selected.forEach((b, i) => {
    pos.set(b.x + b.w / 2, b.y * LAYER_H + LAYER_H / 2, b.z + b.d / 2);
    scale.set(Math.max(0.1, b.w - BODY_GAP), LAYER_H - BODY_GAP, Math.max(0.1, b.d - BODY_GAP));
    matrix.compose(pos, quat, scale);
    bodies.setMatrixAt(i, matrix);
    color.set(options.forceColor ?? brickColorHex(b));
    bodies.setColorAt(i, color);
  });
  bodies.instanceMatrix.needsUpdate = true;
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  group.add(bodies);

  const occupiedAbove = new Set<string>();
  if (!options.allStuds) {
    for (const b of selected) {
      for (let dx = 0; dx < b.w; dx++)
        for (let dz = 0; dz < b.d; dz++) occupiedAbove.add(`${b.x + dx},${b.y + 1},${b.z + dz}`);
    }
  }

  const studPositions: Array<[number, number, number, string]> = [];
  for (const b of selected) {
    for (let dx = 0; dx < b.w; dx++) {
      for (let dz = 0; dz < b.d; dz++) {
        const key = `${b.x + dx},${b.y + 1},${b.z + dz}`;
        if (!options.allStuds && occupiedAbove.has(key)) continue;
        studPositions.push([
          b.x + dx + 0.5,
          b.y * LAYER_H + LAYER_H + 0.09,
          b.z + dz + 0.5,
          options.forceColor ? `#${options.forceColor.toString(16).padStart(6, '0')}` : brickColorHex(b),
        ]);
      }
    }
  }

  if (studPositions.length) {
    const studGeo = new THREE.CylinderGeometry(0.3, 0.31, 0.18, 18, 1);
    const studs = new THREE.InstancedMesh(studGeo, mat.clone(), studPositions.length);
    studs.castShadow = true;
    studs.receiveShadow = true;
    studPositions.forEach(([x, y, z, hex], i) => {
      pos.set(x, y, z);
      scale.set(1, 1, 1);
      matrix.compose(pos, quat, scale);
      studs.setMatrixAt(i, matrix);
      color.set(hex);
      studs.setColorAt(i, color);
    });
    studs.instanceMatrix.needsUpdate = true;
    if (studs.instanceColor) studs.instanceColor.needsUpdate = true;
    group.add(studs);
  }

  return group;
}

export function createIssueBoxes(bricks: Brick[], ids: Set<string>, hex: number): THREE.Group {
  const group = new THREE.Group();
  const list = bricks.filter((b) => ids.has(b.id));
  if (!list.length) return group;
  const geo = new THREE.BoxGeometry(1.04, LAYER_H + 0.08, 1.04);
  const mat = new THREE.MeshBasicMaterial({ color: hex, wireframe: true, transparent: true, opacity: 0.95 });
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  list.forEach((b, i) => {
    p.set(b.x + b.w / 2, b.y * LAYER_H + LAYER_H / 2, b.z + b.d / 2);
    s.set(b.w + 0.12, 1, b.d + 0.12);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return group;
}

export function centerAndSize(bricks: Brick[]): { center: THREE.Vector3; size: THREE.Vector3; maxY: number } {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let maxY = 0;
  for (const b of bricks) {
    minX = Math.min(minX, b.x);
    minZ = Math.min(minZ, b.z);
    maxX = Math.max(maxX, b.x + b.w);
    maxZ = Math.max(maxZ, b.z + b.d);
    maxY = Math.max(maxY, (b.y + 1) * LAYER_H + 0.2);
  }
  if (!Number.isFinite(minX)) {
    minX = minZ = 0;
    maxX = maxZ = 10;
    maxY = 5;
  }
  const center = new THREE.Vector3((minX + maxX) / 2, maxY / 2, (minZ + maxZ) / 2);
  const size = new THREE.Vector3(Math.max(1, maxX - minX), maxY, Math.max(1, maxZ - minZ));
  return { center, size, maxY };
}

export function addStudioLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a94a6, 1.65));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(18, 32, 22);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 120;
  key.shadow.camera.left = -45;
  key.shadow.camera.right = 45;
  key.shadow.camera.top = 45;
  key.shadow.camera.bottom = -45;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ec5ff, 0.9);
  rim.position.set(-24, 18, -18);
  scene.add(rim);
}

export function createBasePlate(width: number, depth: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(width + 1, 0.35, depth + 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xd7d9dc, roughness: 0.58, metalness: 0 });
  const plate = new THREE.Mesh(geo, mat);
  plate.position.set(width / 2, -0.2, depth / 2);
  plate.receiveShadow = true;
  return plate;
}

export function disposeThreeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}
