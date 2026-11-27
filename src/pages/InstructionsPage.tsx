import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../state/store';
import { Badge, Button, Card, EmptyState, Stat } from '../components/ui';
import StudioViewer, { type StudioViewerHandle } from '../components/StudioViewer';
import { BRICK_TYPE_MAP, PALETTE_MAP } from '../lib/palette';
import { exportPartsCsv, exportStepCsv } from '../lib/csv';
import { exportInstructionsPdf, layerRows } from '../lib/pdf';
import { renderBricksDataUrl } from '../lib/thumbnail';
import { runConversion } from '../lib/pipeline';
import { downloadBlob } from '../lib/utils';

type Tab = 'steps' | 'structure' | 'bom';

export default function InstructionsPage() {
  const { currentProject, saveProject, getSource, setPage, setBusy } = useStudio();
  const viewer = useRef<StudioViewerHandle | null>(null);
  const [layer, setLayer] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ghost, setGhost] = useState(true);
  const [tab, setTab] = useState<Tab>('steps');
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const layers = useMemo(() => {
    if (!currentProject?.bricks.length) return [];
    return [...new Set(currentProject.bricks.map((b) => b.y))].sort((a, b) => a - b);
  }, [currentProject?.bricks]);

  useEffect(() => {
    setLayer((l) => (layers.includes(l) ? l : layers[0] ?? 0));
  }, [layers]);

  useEffect(() => {
    if (!playing || layers.length < 2) return;
    const id = window.setInterval(() => {
      setLayer((l) => {
        const i = layers.indexOf(l);
        return layers[(i + 1) % layers.length];
      });
    }, 1400);
    return () => window.clearInterval(id);
  }, [playing, layers]);

  if (!currentProject) {
    return <EmptyState icon="📐" title="请先打开订单工程" action={<Button variant="primary" onClick={() => setPage('orders')}>订单列表</Button>} />;
  }
  const project = currentProject;
  const fresh = project.bricks.filter((b) => b.y === layer);
  const oldBricks = ghost ? project.bricks.filter((b) => b.y < layer) : [];
  const rows = layerRows(project, layer);
  const errorIds = new Set(project.issues.filter((i) => i.severity === 'error').map((i) => i.brickId));
  const warningIds = new Set(project.issues.filter((i) => i.severity === 'warning').map((i) => i.brickId));
  const highlightIds = tab === 'structure' ? new Set([...errorIds, ...warningIds]) : errorIds;
  const totalQty = project.partCounts.reduce((s, p) => s + p.quantity, 0);

  const reinforce = async () => {
    setBusy('正在重新计算支撑与咬合…');
    try {
      const updated = {
        ...project,
        settings: { ...project.settings, autoSupport: true, reinforceSingleStuds: true },
      };
      const result = await runConversion(updated, getSource(project.id));
      saveProject({ ...updated, ...result });
      setMessage('已生成支撑并完成结构校验：所有非底层砖均与下层咬合。');
    } finally {
      setBusy(null);
    }
  };

  const doPdf = async () => {
    setExporting(true);
    setMessage(null);
    try {
      await exportInstructionsPdf(project, (l) => {
        const fromViewer = viewer.current?.captureLayer(l);
        if (fromViewer) return fromViewer;
        const f = project.bricks.filter((b) => b.y === l);
        const g = project.bricks.filter((b) => b.y < l);
        return renderBricksDataUrl(f, { width: 1200, height: 760, ghost: g, basePlateSize: project.grid ? { w: project.grid.nx, d: project.grid.nz } : undefined });
      });
      setMessage('分步图纸 PDF 已导出。');
    } catch (err) {
      alert(`PDF 导出失败：${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const doPng = () => {
    const url = renderBricksDataUrl(project.bricks, {
      width: 2000,
      height: 1500,
      basePlateSize: project.grid ? { w: project.grid.nx, d: project.grid.nz } : undefined,
    });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}-成品效果图.png`;
    a.click();
  };

  return (
    <div className="page instructions-page">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">BUILD GUIDE</p>
          <h1>搭建图纸与结构校验</h1>
          <p className="page-desc">按层分步，每一步只新增当前层砖；红色为悬空，黄色/线框为单凸点弱连接。</p>
        </div>
        <div className="actions wrap">
          <Button onClick={() => exportPartsCsv(project)}>零件清单 CSV</Button>
          <Button onClick={doPng}>成品效果图 PNG</Button>
          <Button variant="primary" disabled={exporting || !layers.length} onClick={() => void doPdf()}>
            {exporting ? '正在生成 PDF…' : '导出分步图纸 PDF'}
          </Button>
        </div>
      </div>

      <div className="stat-grid four">
        <Stat label="总砖数" value={project.stats?.brickCount ?? project.bricks.length} hint={`采购总数 ${totalQty}`} tone="accent" />
        <Stat label="层数 / 步数" value={project.stats?.layerCount ?? layers.length} hint="一层对应一个图纸步骤" />
        <Stat label="悬空砖" value={project.stats?.floatingCount ?? 0} tone={project.stats?.floatingCount ? 'bad' : 'good'} hint="自动支撑后应为 0" />
        <Stat label="单凸点提示" value={project.stats?.singleStudCount ?? project.issues.filter((i) => i.kind === 'single-stud').length} tone="warn" hint="已在结构页列出" />
      </div>

      {message && <div className="inline-info">✅ {message}</div>}

      <div className="guide-layout">
        <Card
          className="guide-viewer-card"
          title={tab === 'steps' ? `第 ${layer + 1} 步 / 共 ${layers.length} 步` : '结构分析视图'}
          subtitle={tab === 'steps' ? `本步新加 ${fresh.length} 块${ghost ? '，灰色半透明为已完成层' : '，仅显示新砖'}` : '红框悬空；红/橙线框为弱连接'}
          action={
            <div className="viewer-actions">
              <Button size="sm" onClick={() => viewer.current?.resetView()}>复位视角</Button>
            </div>
          }
        >
          {project.bricks.length ? (
            <StudioViewer
              ref={viewer}
              bricks={tab === 'structure' ? project.bricks : fresh}
              ghostBricks={tab === 'steps' ? oldBricks : []}
              allBricksForExport={project.bricks}
              highlightIds={highlightIds}
              basePlateSize={project.grid ? { w: project.grid.nx, d: project.grid.nz } : undefined}
              fitToken={project.id}
              height={590}
            />
          ) : (
            <EmptyState icon="🧱" title="还没有搭建方案" description="请先运行体素化与合砖。" action={<Button variant="primary" onClick={() => setPage('voxel')}>前往体素化</Button>} />
          )}

          {tab === 'steps' && layers.length > 0 && (
            <div className="step-controls">
              <Button size="sm" onClick={() => setLayer(layers[0])}>首层</Button>
              <Button size="sm" onClick={() => setLayer(layers[Math.max(0, layers.indexOf(layer) - 1)])}>← 上一步</Button>
              <button className="play-btn" onClick={() => setPlaying((p) => !p)}>{playing ? '⏸' : '▶'}</button>
              <Button size="sm" onClick={() => setLayer(layers[Math.min(layers.length - 1, layers.indexOf(layer) + 1)])}>下一步 →</Button>
              <Button size="sm" onClick={() => setLayer(layers[layers.length - 1])}>顶层</Button>
              <input
                className="layer-slider"
                type="range"
                min={0}
                max={layers.length - 1}
                value={Math.max(0, layers.indexOf(layer))}
                onChange={(e) => { setPlaying(false); setLayer(layers[Number(e.target.value)]); }}
              />
              <label className="mini-toggle"><input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} /> 旧层参考</label>
            </div>
          )}
        </Card>

        <Card className="guide-side">
          <div className="tabs">
            <button className={tab === 'steps' ? 'active' : ''} onClick={() => setTab('steps')}>本步清单</button>
            <button className={tab === 'structure' ? 'active bad-tab' : ''} onClick={() => setTab('structure')}>
              结构 {project.issues.length ? `(${project.issues.length})` : '✓'}
            </button>
            <button className={tab === 'bom' ? 'active' : ''} onClick={() => setTab('bom')}>完整 BOM</button>
          </div>

          {tab === 'steps' && (
            <div className="side-content">
              <div className="side-head">
                <h3>第 {layer + 1} 层新增零件</h3>
                <Button size="sm" onClick={() => exportStepCsv(project, layer)}>本层 CSV</Button>
              </div>
              <div className="part-list">
                {rows.length === 0 && <p className="muted">请先选择有效步骤。</p>}
                {rows.map((r) => (
                  <div key={`${r.partNo}-${r.colorName}-${r.support}`} className="part-row">
                    <span className="part-swatch" style={{ background: r.hex }} />
                    <div><b>{r.name}</b><small>{r.partNo} · {r.colorName}{r.support ? ' · 支撑' : ''}</small></div>
                    <strong>×{r.qty}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'structure' && (
            <div className="side-content">
              <div className="structure-summary">
                <Badge tone={project.stats?.floatingCount ? 'bad' : 'good'}>
                  {project.stats?.floatingCount ? `${project.stats.floatingCount} 个悬空` : '✓ 无悬空'}
                </Badge>
                <Badge tone="warn">{project.stats?.singleStudCount ?? 0} 个单凸点提示</Badge>
              </div>
              <p className="control-hint">
                硬指标：开启自动支撑后，每块 y&gt;0 的砖至少与下层一块砖咬住；底层与底板咬合。
                1×1 砖物理上只有一个凸点，因此保留为可审查警告。
              </p>
              <Button variant="success" onClick={() => void reinforce()}>一键生成/加强支撑</Button>
              <div className="issue-list">
                {project.issues.slice(0, 80).map((i) => {
                  const b = project.bricks.find((x) => x.id === i.brickId);
                  return (
                    <div key={i.id} className={`issue-row ${i.severity}`}>
                      <span>{i.severity === 'error' ? '⛔' : '⚠️'}</span>
                      <div>
                        <b>{i.message}</b>
                        {b && <small>坐标 x{b.x}, y{b.y + 1}, z{b.z} · {b.w}×{b.d}</small>}
                      </div>
                    </div>
                  );
                })}
                {!project.issues.length && <div className="all-good">🎉 没有悬空或弱连接警告。</div>}
              </div>
            </div>
          )}

          {tab === 'bom' && (
            <div className="side-content">
              <div className="side-head">
                <h3>采购零件清单</h3>
                <Button size="sm" variant="primary" onClick={() => exportPartsCsv(project)}>导出 CSV</Button>
              </div>
              <div className="part-list">
                {project.partCounts.map((p) => {
                  const t = BRICK_TYPE_MAP[p.typeId];
                  const c = PALETTE_MAP[p.colorId];
                  return (
                    <div key={`${p.typeId}-${p.colorId}-${p.support}`} className="part-row">
                      <span className="part-swatch" style={{ background: c?.hex ?? '#999' }} />
                      <div>
                        <b>{t?.name ?? p.typeId}</b>
                        <small>{t?.partNo} · {c?.name ?? p.colorId}{p.support ? ' · 支撑' : ''}</small>
                      </div>
                      <strong>×{p.quantity}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
