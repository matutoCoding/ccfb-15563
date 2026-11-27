import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { bricksToRender } from '../components/BrickView';
import { BrickView } from '../components/BrickView';
import { createCatMesh, createHouseMesh } from '../core/procedural';
import { convertMesh } from '../services/convert';
import { BRICK_TYPES } from '../core/brickTypes';

export function VoxelPage() {
  const orders = useStore((s) => s.orders);
  const currentId = useStore((s) => s.currentId);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const gpu = useStore((s) => s.gpuAvailable);
  const setBusy = useStore((s) => s.setBusy);
  const [reRunSource, setReRunSource] = useState<'cat' | 'house' | null>(null);
  const nav = useNavigate();

  const order = orders.find((o) => o.id === currentId) ?? null;
  const result = order?.result;
  const renderBricks = useMemo(
    () => (result ? bricksToRender(result.bricks, result.palette) : []),
    [result]
  );

  const rerun = async (kind: 'cat' | 'house') => {
    if (!order) return;
    setReRunSource(kind);
    const mesh = kind === 'cat' ? createCatMesh() : createHouseMesh();
    await convertMesh(order.id, mesh, { kind });
    setReRunSource(null);
  };

  const rerunUpload = async () => {
    if (!order?.source) { alert('该订单没有可重跑的源模型,请先到模型导入页上传'); return; }
    setBusy('请重新上传源模型以应用新参数…');
    setBusy(null);
    nav('/import');
  };

  return (
    <div>
      <h2 className="page-title">体素化与合砖</h2>
      <p className="page-sub">
        {gpu ? '计算着色器(GPU)体素化已启用,自动回退 CPU' : 'WebGPU 不可用,使用 CPU 体素化(数学实现与 GPU 完全一致)'}
      </p>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>参数</h3>
          <div className="field">
            <label>目标分辨率(最长边颗粒数):{settings.targetResolution}</label>
            <div className="slider-row">
              <input type="range" min={24} max={128} step={4} value={settings.targetResolution}
                onChange={(e) => setSettings({ targetResolution: +e.target.value })} />
            </div>
            <div className="muted" style={{ fontSize: 11 }}>分辨率越高细节越多,颗粒数约按三次方增长</div>
          </div>
          <div className="field">
            <label>外壳厚度:{settings.shellThickness} 颗粒(内部掏空省料,薄壁保证不断开)</label>
            <div className="slider-row">
              <input type="range" min={1} max={5} step={1} value={settings.shellThickness}
                onChange={(e) => setSettings({ shellThickness: +e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>颗粒边长:{settings.voxelSizeMm} mm</label>
            <div className="slider-row">
              <input type="range" min={4} max={16} step={1} value={settings.voxelSizeMm}
                onChange={(e) => setSettings({ voxelSizeMm: +e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>允许砖型</label>
            <div className="row wrap">
              {BRICK_TYPES.map((t) => {
                const on = settings.enabledBrickTypes.includes(t.id);
                return (
                  <span key={t.id} className={`pill ${on ? 'on' : ''}`}
                    onClick={() => {
                      const next = on
                        ? settings.enabledBrickTypes.filter((x) => x !== t.id)
                        : [...settings.enabledBrickTypes, t.id];
                      if (next.length) setSettings({ enabledBrickTypes: next });
                    }}>
                    {t.name}
                  </span>
                );
              })}
            </div>
          </div>
          <label className="row" style={{ color: 'var(--fg)', margin: '8px 0 16px' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={settings.autoSupport}
              onChange={(e) => setSettings({ autoSupport: e.target.checked })} />
            自动补支撑(消除悬空与悬挑)
          </label>

          <div className="row wrap">
            <button className="ghost" disabled={!order || reRunSource !== null} onClick={() => rerun('cat')}>用新参数跑猫样件</button>
            <button className="ghost" disabled={!order || reRunSource !== null} onClick={() => rerun('house')}>用新参数跑房子样件</button>
            <button disabled={!order} onClick={rerunUpload}>重跑上传模型</button>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>转换结果</h3>
          {!result && <div className="muted">还没有方案。先到模型导入页转换,或在左侧跑程序化样件。</div>}
          {result && (
            <>
              <div className="grid cols-3" style={{ marginBottom: 14 }}>
                <div><div className="stat">{result.solidVoxels}</div><div className="stat-label">实心体素</div></div>
                <div><div className="stat">{result.bricks.length}</div><div className="stat-label">砖块总数</div></div>
                <div><div className="stat">{result.dims.z}</div><div className="stat-label">层数</div></div>
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                网格 {result.dims.x}×{result.dims.y}×{result.dims.z} · 成品约
                {(result.dims.x * result.voxelSizeMm / 10).toFixed(1)}×
                {(result.dims.y * result.voxelSizeMm / 10).toFixed(1)}×
                {(result.dims.z * result.voxelSizeMm / 10).toFixed(1)} cm
              </div>
              {result.timings && (
                <div className="muted mono" style={{ fontSize: 11, lineHeight: 1.7 }}>
                  体素化 {result.timings.voxelizeMs.toFixed(0)}ms · 掏空 {result.timings.hollowMs.toFixed(0)}ms ·
                  配色 {result.timings.quantizeMs.toFixed(0)}ms · 合砖 {result.timings.mergeMs.toFixed(0)}ms ·
                  稳定性 {result.timings.stabilityMs.toFixed(0)}ms ·
                  <b style={{ color: 'var(--ok)' }}> 合计 {result.timings.totalMs.toFixed(0)}ms / 预算 10000ms</b>
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>稳定性</b>
                  <span className="tag" style={{
                    background: result.report.floatingCount ? 'rgba(224,85,85,.2)' : 'rgba(76,175,120,.18)',
                    color: result.report.floatingCount ? 'var(--danger)' : 'var(--ok)'
                  }}>
                    悬空 {result.report.floatingCount} · 问题 {result.report.issues.length}
                  </span>
                </div>
                <div style={{ marginTop: 8, maxHeight: 150, overflow: 'auto' }}>
                  {result.report.issues.slice(0, 8).map((iss, i) => (
                    <div key={i} className={`issue ${iss.kind}`}>{iss.message}</div>
                  ))}
                  {!result.report.issues.length && <div className="muted" style={{ fontSize: 12 }}>✓ 无结构问题,每层都有咬合</div>}
                </div>
              </div>
              <button style={{ marginTop: 12 }} onClick={() => nav('/color')}>去配色 →</button>
            </>
          )}
        </div>
      </div>

      {result && (
        <div style={{ marginTop: 16 }}>
          <BrickView bricks={renderBricks} dims={result.dims} />
        </div>
      )}
    </div>
  );
}
