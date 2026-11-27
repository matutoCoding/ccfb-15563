import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Brick } from '../types';
import {
  addStudioLights,
  centerAndSize,
  createBasePlate,
  createBrickGroup,
  createIssueBoxes,
  disposeThreeObject,
} from '../three/brickScene';

export interface StudioViewerHandle {
  capture: () => string | null;
  captureLayer: (layer: number) => string | null;
  resetView: () => void;
}

interface Props {
  bricks: Brick[];
  ghostBricks?: Brick[];
  allBricksForExport?: Brick[];
  highlightIds?: Set<string>;
  basePlateSize?: { w: number; d: number };
  height?: number | string;
  fitToken?: string | number;
  autoRotate?: boolean;
  emptyHint?: string;
}

const StudioViewer = forwardRef<StudioViewerHandle, Props>(function StudioViewer(
  {
    bricks,
    ghostBricks,
    allBricksForExport,
    highlightIds,
    basePlateSize,
    height = 560,
    fitToken,
    autoRotate = false,
    emptyHint = '运行转换后这里会显示可旋转的塑料颗粒模型',
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const contentRef = useRef<THREE.Group | null>(null);
  const baseRef = useRef<THREE.Mesh | null>(null);
  const allExportRef = useRef<Brick[]>(allBricksForExport ?? bricks);
  const [glError, setGlError] = useState<string | null>(null);

  useEffect(() => {
    allExportRef.current = allBricksForExport ?? bricks;
  }, [allBricksForExport, bricks]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (err) {
      setGlError('当前环境无法初始化 WebGL，可使用导出的 PDF/CSV；请在新版 Chrome/Edge 中打开。');
      console.error(err);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef2f7);
    scene.fog = new THREE.Fog(0xeef2f7, 80, 180);
    addStudioLights(scene);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 500);
    camera.position.set(30, 28, 34);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(8, 8, 8);
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 5;
    controls.maxDistance = 160;
    controls.autoRotateSpeed = 1.1;
    controlsRef.current = controls;

    const content = new THREE.Group();
    contentRef.current = content;
    scene.add(content);

    const resize = () => {
      const w = host.clientWidth || 800;
      const h = host.clientHeight || (typeof height === 'number' ? height : 560);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let raf = 0;
    const loop = () => {
      controls.autoRotate = autoRotate;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      disposeThreeObject(content);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      rendererRef.current = null;
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    while (content.children.length) {
      const child = content.children[0];
      content.remove(child);
      disposeThreeObject(child);
    }
    if (basePlateSize) {
      const plate = createBasePlate(basePlateSize.w, basePlateSize.d);
      baseRef.current = plate;
      content.add(plate);
    }
    if (bricks.length) content.add(createBrickGroup(bricks));
    if (ghostBricks?.length) {
      // Limit ghost instances on low-memory machines while keeping orientation.
      const ghost = ghostBricks.length > 12000 ? ghostBricks.slice(-12000) : ghostBricks;
      content.add(createBrickGroup(ghost, { opacity: 0.14, forceColor: 0x718096 }));
    }
    if (highlightIds?.size) {
      const allForHighlight = allBricksForExport ?? bricks;
      content.add(createIssueBoxes(allForHighlight, highlightIds, 0xff3b30));
    }
  }, [bricks, ghostBricks, highlightIds, basePlateSize, allBricksForExport]);

  const fit = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const all = ghostBricks?.length ? [...bricks, ...ghostBricks] : bricks;
    if (!all.length) {
      controls.target.set(8, 8, 8);
      camera.position.set(30, 28, 34);
      controls.update();
      return;
    }
    const { center, size } = centerAndSize(all);
    const maxDim = Math.max(size.x, size.y * 1.15, size.z);
    const distance = maxDim * 1.55 + 8;
    controls.target.copy(center);
    camera.position.set(
      center.x + distance * 0.58,
      center.y + distance * 0.42,
      center.z + distance * 0.72,
    );
    camera.near = 0.1;
    camera.far = Math.max(300, distance * 5);
    camera.updateProjectionMatrix();
    controls.minDistance = Math.max(4, maxDim * 0.18);
    controls.maxDistance = distance * 4;
    controls.update();
  };

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  useImperativeHandle(ref, () => ({
    capture() {
      const r = rendererRef.current;
      const s = sceneRef.current;
      const c = cameraRef.current;
      if (!r || !s || !c) return null;
      r.render(s, c);
      return r.domElement.toDataURL('image/png');
    },
    captureLayer(layer: number) {
      const r = rendererRef.current;
      const s = sceneRef.current;
      const c = cameraRef.current;
      const original = contentRef.current;
      if (!r || !s || !c || !original) return null;
      const all = allExportRef.current;
      const fresh = all.filter((b) => b.y === layer);
      const ghost = all.filter((b) => b.y < layer);
      const temp = new THREE.Group();
      if (basePlateSize) temp.add(createBasePlate(basePlateSize.w, basePlateSize.d));
      temp.add(createBrickGroup(fresh));
      if (ghost.length) temp.add(createBrickGroup(ghost.length > 16000 ? ghost.slice(-16000) : ghost, {
        opacity: 0.13,
        forceColor: 0x718096,
      }));
      s.remove(original);
      s.add(temp);
      r.render(s, c);
      const url = r.domElement.toDataURL('image/png');
      s.remove(temp);
      disposeThreeObject(temp);
      s.add(original);
      r.render(s, c);
      return url;
    },
    resetView: fit,
  }));

  return (
    <div className="viewer-shell" style={{ height }}>
      <div ref={hostRef} className="viewer-host" aria-label="可旋转三维积木视图" />
      {!bricks.length && !glError && <div className="viewer-empty">{emptyHint}</div>}
      {glError && <div className="viewer-empty error">{glError}</div>}
      <div className="viewer-hint">左键旋转 · 滚轮缩放 · 右键平移</div>
    </div>
  );
});

export default StudioViewer;
