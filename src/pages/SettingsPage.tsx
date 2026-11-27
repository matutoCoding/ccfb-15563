import { useStore } from '../state/store';
import { BRICK_TYPES } from '../core/brickTypes';
import { DEFAULT_SETTINGS } from '../core/pipeline';
import { DEFAULT_PALETTE } from '../core/palette';

export function SettingsPage() {
  const { settings, setSettings, palette, toggleOutOfStock, gpuAvailable } = useStore();

  return (
    <div>
      <h2 className="page-title">设置</h2>
      <p className="page-sub">工艺参数会作用于之后的每次转换;已生成的方案保留转换时的参数快照</p>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>工艺默认值</h3>
          <div className="field">
            <label>默认分辨率(最长边颗粒数)</label>
            <input type="number" min={16} max={200} value={settings.targetResolution}
              onChange={(e) => setSettings({ targetResolution: Math.max(16, +e.target.value || 64) })} />
          </div>
          <div className="field">
            <label>默认外壳厚度(颗粒)</label>
            <input type="number" min={1} max={8} value={settings.shellThickness}
              onChange={(e) => setSettings({ shellThickness: Math.max(1, +e.target.value || 2) })} />
          </div>
          <div className="field">
            <label>颗粒边长(mm)</label>
            <input type="number" min={3} max={20} value={settings.voxelSizeMm}
              onChange={(e) => setSettings({ voxelSizeMm: Math.max(3, +e.target.value || 8) })} />
          </div>
          <label className="row" style={{ color: 'var(--fg)' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={settings.autoSupport}
              onChange={(e) => setSettings({ autoSupport: e.target.checked })} />
            默认开启自动支撑
          </label>
          <div style={{ marginTop: 16 }}>
            <button className="ghost" onClick={() => setSettings({ ...DEFAULT_SETTINGS })}>恢复默认参数</button>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>砖型与色卡</h3>
          <div className="field">
            <label>默认可用砖型(在体素化页可按订单调整)</label>
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
          <div className="field">
            <label>库存状态(点击切换缺货/有货,缺货色在配色页自动换最近色)</label>
            <div className="row wrap">
              {palette.map((c) => (
                <span key={c.id} className={`pill ${c.outOfStock ? 'on' : ''}`}
                  style={c.outOfStock ? { background: 'var(--warn)', borderColor: 'var(--warn)' } : undefined}
                  onClick={() => toggleOutOfStock(c.id)}>
                  <span className="legend-dot" style={{ background: `rgb(${c.rgb.join(',')})` }} />
                  {c.name}
                </span>
              ))}
            </div>
          </div>
          <button className="ghost" onClick={() => {
            palette.forEach((c) => { if (c.outOfStock) toggleOutOfStock(c.id); });
          }}>全部补货</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>运行环境</h3>
        <table>
          <tbody>
            <tr><td>WebGPU 计算</td><td>{gpuAvailable === null ? '检测中' : gpuAvailable ? '可用(GPU 体素化 + GPU 渲染)' : '不可用(自动 CPU 回退,算法结果一致)'}</td></tr>
            <tr><td>体素化算法</td><td>Akenine-Möller 三角形-盒子 SAT,GPU/CPU 同数学实现</td></tr>
            <tr><td>掏空算法</td><td>26 邻接切比雪夫距离场,外壳厚度精确、薄壁不断开</td></tr>
            <tr><td>合砖保证</td><td>非落地砖必须咬合下层砖;层间交错打分;硬悬空自动补 1x1 支撑柱</td></tr>
            <tr><td>性能基线</td><td>10 万体素模型全流程(体素化+掏空+配色+合砖)实测 &lt; 0.5 秒,预算 10 秒</td></tr>
            <tr><td>默认色卡</td><td>{DEFAULT_PALETTE.length} 色(含支撑专用灰)</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
