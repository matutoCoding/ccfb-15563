import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import type { OrderStatus } from '../order';
import { downloadText } from '../core/exporters';
import { decodeProject, encodeProject } from '../core/project';

const STATUSES: OrderStatus[] = ['待处理', '转换中', '待审核', '已确认', '已归档'];

export function OrdersPage() {
  const orders = useStore((s) => s.orders);
  const { createOrder, updateOrder, removeOrder, setStatus, selectOrder } = useStore();
  const nav = useNavigate();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', customer: '', note: '' });
  const [filter, setFilter] = useState<'全部' | OrderStatus>('全部');

  const shown = filter === '全部' ? orders : orders.filter((o) => o.status === filter);
  const totalBricks = orders.reduce((s, o) => s + (o.result?.bricks.length ?? 0), 0);

  const exportProject = async (id: string) => {
    const o = orders.find((x) => x.id === id);
    if (!o?.result) return alert('该订单还没有转换结果');
    const file = encodeProject({
      order: { id: o.id, name: o.name, customer: o.customer, note: o.note, status: o.status, createdAt: o.createdAt },
      settings: o.result.settings,
      palette: o.result.palette,
      lockedColorIds: o.result.lockedColorIds,
      dims: o.result.dims,
      voxelSizeMm: o.result.voxelSizeMm,
      maskB64: o.result.maskB64,
      bricks: o.result.bricks,
      steps: o.result.steps,
      report: o.result.report,
      timings: o.result.timings
    });
    downloadText(`${o.name}.bfproj.json`, JSON.stringify(file, null, 2), 'application/json');
  };

  const importProject = async (file: File) => {
    try {
      const proj = decodeProject(JSON.parse(await file.text()));
      const id = await createOrder({ name: proj.order.name, customer: proj.order.customer, note: proj.order.note });
      await updateOrder(id, {
        source: { kind: 'upload', fileName: file.name },
        result: {
          dims: proj.dims, voxelSizeMm: proj.voxelSizeMm, maskB64: proj.maskB64,
          maskLength: proj.dims.x * proj.dims.y * proj.dims.z,
          bricks: proj.bricks, steps: proj.steps, report: proj.report,
          palette: proj.palette, lockedColorIds: proj.lockedColorIds,
          settings: proj.settings,
          solidVoxels: proj.bricks.reduce((s, b) => s + b.nx * b.ny, 0),
          timings: proj.timings
        }
      });
      alert('工程已导入');
    } catch (e) {
      alert(`导入失败:${(e as Error).message}`);
    }
  };

  return (
    <div>
      <h2 className="page-title">订单列表</h2>
      <p className="page-sub">管理定制订单与工程文件,工程可导出为 .bfproj 跨设备迁移</p>

      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <div className="card"><div className="stat">{orders.length}</div><div className="stat-label">订单总数</div></div>
        <div className="card"><div className="stat">{orders.filter((o) => o.status === '待处理').length}</div><div className="stat-label">待处理</div></div>
        <div className="card"><div className="stat">{orders.filter((o) => o.result).length}</div><div className="stat-label">已出方案</div></div>
        <div className="card"><div className="stat">{totalBricks}</div><div className="stat-label">累计砖块</div></div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="row wrap">
            {(['全部', ...STATUSES] as const).map((s) => (
              <span key={s} className={`pill ${filter === s ? 'on' : ''}`} onClick={() => setFilter(s)}>{s}</span>
            ))}
          </div>
          <div className="row">
            <input type="file" accept=".json,.bfproj" style={{ display: 'none' }} id="import-proj"
              onChange={(e) => e.target.files?.[0] && importProject(e.target.files[0])} />
            <label htmlFor="import-proj" className="btn ghost" style={{ margin: 0 }}>导入工程</label>
            <button onClick={() => setEditing('new')}>+ 新建订单</button>
          </div>
        </div>

        {editing === 'new' && (
          <div className="card" style={{ background: 'var(--bg)', marginBottom: 14 }}>
            <div className="grid cols-3">
              <div className="field"><label>订单名称</label><input value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="如:橘猫摆件 A7" /></div>
              <div className="field"><label>客户</label><input value={draft.customer}
                onChange={(e) => setDraft({ ...draft, customer: e.target.value })} /></div>
              <div className="field"><label>备注</label><input value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></div>
            </div>
            <div className="row">
              <button disabled={!draft.name} onClick={async () => {
                const id = await createOrder(draft);
                setDraft({ name: '', customer: '', note: '' });
                setEditing(null);
                selectOrder(id);
                nav('/import');
              }}>创建并去导入模型</button>
              <button className="ghost" onClick={() => setEditing(null)}>取消</button>
            </div>
          </div>
        )}

        <table>
          <thead><tr><th>订单</th><th>客户</th><th>状态</th><th>方案</th><th>更新时间</th><th>操作</th></tr></thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{o.name}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{o.note || '—'}</div>
                </td>
                <td>{o.customer || '—'}</td>
                <td>
                  <select value={o.status} style={{ width: 100 }}
                    onChange={(e) => setStatus(o.id, e.target.value as OrderStatus)}>
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td>{o.result ? <span className="tag 待审核">{o.result.bricks.length} 块 · {o.result.dims.z} 层</span> : <span className="muted">未转换</span>}</td>
                <td className="muted">{new Date(o.updatedAt).toLocaleString('zh-CN')}</td>
                <td>
                  <div className="row">
                    <button className="ghost" onClick={() => { selectOrder(o.id); nav('/voxel'); }}>打开</button>
                    <button className="ghost" onClick={() => exportProject(o.id)}>导出</button>
                    <button className="danger" onClick={() => confirm(`删除订单「${o.name}」?`) && removeOrder(o.id)}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>暂无订单</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
