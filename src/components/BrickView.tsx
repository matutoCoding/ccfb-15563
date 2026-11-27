import { useEffect, useRef } from 'react';
import { BrickRenderer, bricksToRender, type RenderBrick } from '../gpu/BrickRenderer';
import type { Vec3 } from '../core/types';

interface Props {
  bricks: RenderBrick[];
  dims?: Vec3;
  alpha?: number;
  onReady?: (r: BrickRenderer) => void;
}

/** WebGPU 3D 视图;浏览器不支持时给明确提示而不是白屏 */
export function BrickView({ bricks, dims, alpha = 1, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BrickRenderer | null>(null);
  const errRef = useRef<HTMLDivElement>(null);
  const lastFitKey = useRef('');

  useEffect(() => {
    let alive = true;
    BrickRenderer.create(canvasRef.current!)
      .then((r) => {
        if (!alive) { r.destroy(); return; }
        rendererRef.current = r;
        onReady?.(r);
      })
      .catch((e) => {
        if (errRef.current) errRef.current.textContent = `3D 渲染不可用:${e.message}。核心转换与图纸导出不受影响。`;
      });
    return () => { alive = false; rendererRef.current?.destroy(); rendererRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !dims) return;
    r.setBricks(bricks);
    // 仅模型网格尺寸变化时重新取景,分步切换不重置用户视角
    const key = `${dims.x}x${dims.y}x${dims.z}`;
    if (lastFitKey.current !== key) {
      lastFitKey.current = key;
      r.fitView(dims);
    }
  }, [bricks, dims]);

  useEffect(() => { rendererRef.current?.setAlpha(alpha); }, [alpha]);

  return (
    <div className="viewport">
      <canvas ref={canvasRef} />
      <div ref={errRef} className="viewport-hint" style={{ color: 'var(--warn)' }} />
      <div className="viewport-hint">左键旋转 · 滚轮缩放 · 右键平移</div>
    </div>
  );
}

export { bricksToRender };
export type { RenderBrick };
