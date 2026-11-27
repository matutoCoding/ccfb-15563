import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { BrickView, type RenderBrick } from '../components/BrickView';
import type { BrickRenderer } from '../gpu/BrickRenderer';
import { buildPartList, buildStepDetails, buildSummary } from '../core/instructions';
import { buildInstructionsPdf, partsListCsv, downloadBlob } from '../core/exporters';

export function InstructionsPage() {
  const orders = useStore((s) => s.orders);
  const currentId = useStore((s) => s.currentId);
  const nav = useNavigate();
  const order = orders.find((o) => o.id === currentId) ?? null;
  const result = order?.result;
  const [stepIdx, setStepIdx] = useState(0);
  const [ghost, setGhost] = useState(true);
  const rendererRef = useRef<BrickRenderer | null>(null);

  const details = useMemo(
    () => (result ? buildStepDetails(result.steps, result.bricks, result.palette) : []),
    [result]
  );
  const parts = useMemo(
    () => (result ? buildPartList(result.bricks, result.palette) : []),
    [result]
  );
  const summary = useMemo(
    () => (result ? buildSummary(result.bricks, result.steps) : null),
    [result]
  );

  const viewBricks: RenderBrick[] = useMemo(() => {
    if (!result) return [];
    const current = details[stepIdx];
    const newIds = new Set(current?.step.brickIds ?? []);
    return result.bricks.map((b) => {
      const isNew = newIds.has(b.id);
      const isPast = b.z < (current?.step.layer ?? 0);
      const rgb = result.palette.find((c) => c.id === b.colorId)?.rgb ?? [128, 128, 128];
      return {
        x: b.x, y: b.y, z: b.z, nx: b.nx, ny: b.ny,
        rgb, highlight: isNew,
        // 未搭到的砖在 ghost 模式下半透明
        ...(ghost && !isNew && !isPast ? { alpha: 0.18 } : {})
      } as RenderBrick;
    });
  }, [result, details, stepIdx, ghost]);

  if (!result || !summary) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 60 }}>
        <p className="muted">当前订单还没有转换结果</p>
        <button onClick={() => nav('/voxel')}>去体素化</button>
      </div>
    );
  }

  const current = details[stepIdx];

  const exportPdf = async () => {
    const canvas = rendererRef.current ? document.querySelector('.viewport canvas') as HTMLCanvasElement : undefined;
    const blob = await buildInstructionsPdf({
      orderName: order!.name, bricks: result.bricks, steps: result.steps,
      palette: result.palette, dims: result.dims, renderCanvas: canvas ?? undefined
    });
    downloadBlob(`${order!.name}-搭建图纸.pdf`, blob);
  };

  const exportCsv = () => {
    const csv = partsListCsv(result.bricks, result.palette, order!.name);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(`${order!.name}-零件清单.csv`, blob);
  };

  const exportPng = () => {
    const canvas = document.querySelector('.viewport canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    canvas.toBlob((b) => b && downloadBlob(`${order!.name}-效果图.png`, b), 'image/png');
  };

  return (
    <div>
      <h2 className="page-title">搭建图纸</h2>
      <p className="page-sub">按层分步,每步只高亮新放的砖;半透明为尚未搭建的部分</p>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card"><div className="stat">{summary.totalBricks}</div><div className="stat-label">总砖数(支撑 {summary.supportBricks})</div></div>
        <div className="card"><div className="stat">{summary.stepCount}</div><div className="stat-label">搭建步骤</div></div>
        <div className="card"><div className="stat">{summary.layerCount}</div><div className="stat-label">层数</div></div>
        <div className="card"><div className="stat">{summary.colorKinds}</div><div className="stat-label">颜色种类</div></div>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'stretch' }}>
        <div>
          <BrickView bricks={viewBricks} dims={result.dims} onReady={(r) => { rendererRef.current = r; }} />
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row">
                <button className="ghost" disabled={stepIdx === 0} onClick={() => setStepIdx(stepIdx - 1)}>上一步</button>
                <b>Step {stepIdx + 1} / {details.length}(第 {current.step.layer + 1} 层,新增 {current.newBrickCount} 块)</b>
                <button className="ghost" disabled={stepIdx >= details.length - 1} onClick={() => setStepIdx(stepIdx + 1)}>下一步</button>
              </div>
              <label className="row" style={{ color: 'var(--fg)', margin: 0 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={ghost}
                  onChange={(e) => setGhost(e.target.checked)} /> 半透明未搭建
              </label>
            </div>
            <input type="range" min={0} max={details.length - 1} value={stepIdx}
              onChange={(e) => setStepIdx(+e.target.value)} style={{ marginTop: 10 }} />
            <div style={{ marginTop: 10 }}>
              <b>本步零件</b>
              <table style={{ marginTop: 6 }}>
                <tbody>
                  {current.parts.map((p) => (
                    <tr key={`${p.typeId}-${p.colorId}`}>
                      <td><span className="swatch" style={{ background: `rgb(${p.rgb.join(',')})` }} /></td>
                      <td>{p.typeName} {p.support ? '(支撑)' : ''}</td>
                      <td>{p.colorName}</td>
                      <td>×{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 180px)' }}>
          <h3 style={{ marginTop: 0 }}>完整零件清单</h3>
          <table>
            <thead><tr><th></th><th>砖型</th><th>颜色</th><th>数量</th></tr></thead>
            <tbody>
              {parts.map((p) => (
                <tr key={`${p.typeId}-${p.colorId}`}>
                  <td><span className="swatch" style={{ background: `rgb(${p.rgb.join(',')})` }} /></td>
                  <td>{p.typeId} <span className="muted">{p.support ? '支撑件' : ''}</span></td>
                  <td>{p.colorName}</td>
                  <td>×{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 16 }} className="row wrap">
            <button onClick={exportPdf}>导出分步 PDF</button>
            <button className="ghost" onClick={exportCsv}>导出零件 CSV</button>
            <button className="ghost" onClick={exportPng}>导出效果图 PNG</button>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
            PDF 含封面总览、全量零件表与每步俯视层位图;CSV 带 UTF-8 BOM,Excel 直接打开不乱码。
          </p>
        </div>
      </div>
    </div>
  );
}
