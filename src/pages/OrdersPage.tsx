import { useRef, useState } from 'react';
import { useStudio } from '../state/store';
import type { Order } from '../types';
import { Badge, Button, Card, EmptyState, Modal, Stat } from '../components/ui';
import { formatNumber } from '../lib/utils';

const STATUSES: Order['status'][] = ['新订单', '处理中', '待确认', '已完成'];

async function fileToPhotoDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const max = 520;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法读取照片');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.82);
}

const emptyForm: Partial<Order> = {
  customer: '',
  petName: '',
  title: '',
  status: '新订单',
  dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  quantity: 1,
  budget: 800,
  note: '',
};

export default function OrdersPage() {
  const {
    orders,
    projects,
    openOrder,
    createOrderWithProject,
    updateOrder,
    deleteOrder,
    importProjectFile,
  } = useStudio();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('全部');
  const [editing, setEditing] = useState<Order | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<Order>>(emptyForm);
  const [template, setTemplate] = useState<'cat' | 'house' | 'blank'>('cat');
  const importRef = useRef<HTMLInputElement | null>(null);

  const filtered = orders.filter((o) => {
    const q = query.trim().toLowerCase();
    const matchQ =
      !q ||
      [o.code, o.customer, o.petName, o.title, o.note].some((v) => v.toLowerCase().includes(q));
    return matchQ && (status === '全部' || o.status === status);
  });

  const openCreate = () => {
    setForm(emptyForm);
    setTemplate('cat');
    setCreating(true);
  };

  const submitCreate = () => {
    const id = createOrderWithProject(
      {
        ...form,
        title: form.title?.trim() || (form.petName ? `${form.petName}颗粒摆件` : '未命名颗粒摆件'),
        customer: form.customer?.trim() || '散客',
      },
      template === 'blank' ? undefined : template,
    );
    setCreating(false);
    openOrder(id, template === 'blank' ? 'import' : 'voxel');
  };

  const submitEdit = () => {
    if (!editing) return;
    updateOrder(editing.id, form);
    setEditing(null);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      await importProjectFile(file);
    } catch (err) {
      alert(`工程导入失败：${(err as Error).message}`);
    }
  };

  const totalBricks = Object.values(projects).reduce((s, p) => s + p.bricks.length, 0);
  const ready = Object.values(projects).filter((p) => p.stats && p.stats.floatingCount === 0).length;

  return (
    <div className="page orders-page">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">ORDER DESK</p>
          <h1>订单列表</h1>
          <p className="page-desc">客户、宠物资料、工程文件和生产状态都在一个本地工作台中。</p>
        </div>
        <div className="actions">
          <input
            ref={importRef}
            type="file"
            accept=".json,.brickforge.json,application/json"
            hidden
            onChange={(e) => onImport(e.target.files?.[0])}
          />
          <Button onClick={() => importRef.current?.click()}>导入工程</Button>
          <Button variant="primary" onClick={openCreate}>＋ 新建订单</Button>
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="全部订单" value={orders.length} hint="本地浏览器持久化" tone="accent" />
        <Stat label="已完成结构方案" value={ready} hint="0 悬空为合格" tone="good" />
        <Stat label="累计规划砖数" value={formatNumber(totalBricks)} hint="含自动支撑" />
        <Stat label="待处理" value={orders.filter((o) => o.status !== '已完成').length} tone="warn" />
      </div>

      <Card
        title="订单"
        subtitle="点击打开进入模型导入、体素、配色和图纸流程"
        action={
          <div className="table-tools">
            <input
              className="input"
              placeholder="搜索单号 / 客户 / 宠物"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option>全部</option>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon="🧱"
            title="还没有匹配订单"
            description="新建订单时可直接生成内置坐姿猫或小房子，也可以导入 OBJ/glTF。"
            action={<Button variant="primary" onClick={openCreate}>新建第一个订单</Button>}
          />
        ) : (
          <div className="order-grid">
            {filtered.map((o) => {
              const p = projects[o.id];
              return (
                <article key={o.id} className="order-card" onClick={() => openOrder(o.id, p?.grid ? 'instructions' : 'import')}>
                  <div className="order-top">
                    <Badge tone={o.status === '已完成' ? 'good' : o.status === '待确认' ? 'warn' : 'accent'}>{o.status}</Badge>
                    <span className="order-code">{o.code}</span>
                  </div>
                  {o.photoDataUrl && <img className="order-photo" src={o.photoDataUrl} alt={`${o.petName || o.title}参考照片`} />}
                  <h3>{o.title}</h3>
                  <p className="customer">👤 {o.customer || '未填客户'} · 🐾 {o.petName || '未命名宠物'}</p>
                  <p className="note">{o.note || '暂无备注'}</p>
                  <div className="order-meta">
                    <span>交期 <b>{o.dueDate}</b></span>
                    <span>数量 <b>×{o.quantity}</b></span>
                    <span>预算 <b>¥{o.budget}</b></span>
                  </div>
                  <div className="order-project">
                    {p?.stats ? (
                      <>
                        <Badge tone={p.stats.floatingCount ? 'bad' : 'good'}>
                          {p.stats.floatingCount ? `${p.stats.floatingCount} 悬空` : '结构可搭'}
                        </Badge>
                        <span>{formatNumber(p.stats.brickCount)} 砖 · {p.stats.layerCount} 层 · {p.stats.totalMs?.toFixed(0)} ms</span>
                      </>
                    ) : (
                      <Badge tone="warn">尚未转换</Badge>
                    )}
                  </div>
                  <div className="order-actions" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="primary" onClick={() => openOrder(o.id, 'import')}>打开工程</Button>
                    <Button size="sm" onClick={() => { setEditing(o); setForm(o); }}>编辑</Button>
                    <Button size="sm" variant="danger" onClick={() => confirm(`删除订单 ${o.code} 及其本地工程？`) && deleteOrder(o.id)}>
                      删除
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>

      <Modal open={creating} title="新建订单" onClose={() => setCreating(false)}>
        <OrderForm form={form} setForm={setForm} template={template} setTemplate={setTemplate} />
        <div className="modal-actions">
          <Button onClick={() => setCreating(false)}>取消</Button>
          <Button variant="primary" onClick={submitCreate}>创建并进入工程</Button>
        </div>
      </Modal>

      <Modal open={!!editing} title="编辑订单" onClose={() => setEditing(null)}>
        <OrderForm form={form} setForm={setForm} />
        <div className="modal-actions">
          <Button variant="danger" onClick={() => editing && deleteOrder(editing.id)}>删除订单</Button>
          <div className="spacer" />
          <Button onClick={() => setEditing(null)}>取消</Button>
          <Button variant="primary" onClick={submitEdit}>保存</Button>
        </div>
      </Modal>
    </div>
  );
}

function OrderForm({ form, setForm, template, setTemplate }: {
  form: Partial<Order>;
  setForm: (f: Partial<Order>) => void;
  template?: 'cat' | 'house' | 'blank';
  setTemplate?: (t: 'cat' | 'house' | 'blank') => void;
}) {
  const set = <K extends keyof Order>(k: K, v: Order[K]) => setForm({ ...form, [k]: v });
  return (
    <div className="form-grid">
      <label>订单标题<input className="input" value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="例如：橘猫坐姿摆件" /></label>
      <label>客户<input className="input" value={form.customer ?? ''} onChange={(e) => set('customer', e.target.value)} /></label>
      <label>宠物名<input className="input" value={form.petName ?? ''} onChange={(e) => set('petName', e.target.value)} /></label>
      <label>状态
        <select className="input" value={form.status} onChange={(e) => set('status', e.target.value as Order['status'])}>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <label>交期<input type="date" className="input" value={form.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value)} /></label>
      <label>数量<input type="number" min={1} className="input" value={form.quantity ?? 1} onChange={(e) => set('quantity', Number(e.target.value))} /></label>
      <label>预算 ¥<input type="number" min={0} step={50} className="input" value={form.budget ?? 0} onChange={(e) => set('budget', Number(e.target.value))} /></label>
      <label className="span-2 photo-field">
        宠物参考照片（仅本地保存压缩缩略图）
        <input
          type="file"
          accept="image/*"
          className="input"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const photoDataUrl = await fileToPhotoDataUrl(file);
              setForm({ ...form, photoName: file.name, photoDataUrl });
            } catch (err) {
              alert(`照片读取失败：${(err as Error).message}`);
            }
          }}
        />
        {form.photoDataUrl && (
          <span className="photo-preview">
            <img src={form.photoDataUrl} alt="参考照片预览" />
            <button type="button" className="mini-btn warn" onClick={() => setForm({ ...form, photoDataUrl: undefined, photoName: undefined })}>
              移除照片
            </button>
          </span>
        )}
      </label>
      <label className="span-2">备注<textarea className="input" rows={3} value={form.note ?? ''} onChange={(e) => set('note', e.target.value)} /></label>
      {setTemplate && (
        <div className="template-picker span-2">
          <span>没有模型时的初始模板</span>
          <div className="template-options">
            {([
              ['cat', '🐱 坐着的猫'],
              ['house', '🏠 小房子'],
              ['blank', '📦 空工程'],
            ] as const).map(([v, label]) => (
              <button key={v} type="button" className={template === v ? 'active' : ''} onClick={() => setTemplate(v)}>{label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
