import * as THREE from 'three';
import type { Brick } from '../types';
import {
  addStudioLights,
  centerAndSize,
  createBasePlate,
  createBrickGroup,
  createIssueBoxes,
  disposeThreeObject,
} from '../three/brickScene';

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  ghost?: Brick[];
  highlightIds?: Set<string>;
  background?: string | null;
  cameraAngle?: [number, number];
  basePlateSize?: { w: number; d: number };
}

export function renderBricksDataUrl(bricks: Brick[], options: ThumbnailOptions = {}): string {
  const width = options.width ?? 1400;
  const height = options.height ?? 980;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: options.background === null,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  if (options.background !== null) scene.background = new THREE.Color(options.background ?? '#eef2f7');
  addStudioLights(scene);

  const allForBounds = options.ghost?.length ? [...bricks, ...options.ghost] : bricks;
  const bounds = centerAndSize(allForBounds);
  if (options.basePlateSize) {
    scene.add(createBasePlate(options.basePlateSize.w, options.basePlateSize.d));
  }

  scene.add(createBrickGroup(bricks));
  if (options.ghost?.length) scene.add(createBrickGroup(options.ghost, { opacity: 0.16, forceColor: 0x7c8aa0 }));
  if (options.highlightIds?.size) scene.add(createIssueBoxes(bricks, options.highlightIds, 0xff2a2a));

  const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 500);
  const maxDim = Math.max(bounds.size.x, bounds.size.y * 1.1, bounds.size.z);
  const distance = maxDim * 1.55 + 8;
  const [azimuth = Math.PI / 4.2, elevation = 0.42] = options.cameraAngle ?? [];
  camera.position.set(
    bounds.center.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
    bounds.center.y + Math.sin(elevation) * distance + 4,
    bounds.center.z + Math.cos(azimuth) * Math.cos(elevation) * distance,
  );
  camera.lookAt(bounds.center);

  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png');
  disposeThreeObject(scene);
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}
