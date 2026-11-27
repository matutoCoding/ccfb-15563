import { useMemo, useState } from 'react';
import { useStudio } from '../state/store';
import { Badge, Button, Card, EmptyState, Stat, Toggle } from '../components/ui';
import { PALETTE } from '../lib/palette';
import { runConversion } from '../lib/pipeline';
import type { PaletteOverride } from '../types';
import { formatNumber } from '../lib/utils';

export default function ColorPage() {
  const { currentProject, saveProject, getSource, setPage, setBusy } = useStudio();
  const [filter, setFilter] = useState<'all' | 'used' | 'locked' | 'out'>('all');
  const [error, setError] = useState<string | null>(null);

  const usedCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (currentProject?.grid) {
      const g = currentProject.grid;
      for (let i = 0; i < g.color.length; i++) {
        if (g.kind[i] === 0 || g.color[i] >= PALETTE.length) continue;
        const id = PALETTE[g.color[i]].id;
        m.set(id, (m.get(id) ?? 0) + 1);
      }
    }
    return m;
  }, [currentProject?.grid]);

  if (!currentProject) {
    return <EmptyState icon="🎨" title="请先打开订单工程" action={<Button variant="primary" onClick={() => setPage('orders')}>订单列表</Button>} />;
  }
  const project = currentProject;
  const overrides = project.paletteOverrides;

  const updateOverride = (id: string, patch: PaletteOverride) => {
    saveProject({
      ...project,
      paletteOverrides: { ...overrides, [id]: { ...overrides[id], ...patch } },
    });
  };

  const apply = async () => {
    setError(null);
    setBusy('正在量化颜色、替换缺货并重新合砖…');
    try {
      const result = await runConversion(project, getSource(project.id));
      saveProject({ ...project, ...result });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const isStock = (id: string, base: boolean) => overrides[id]?.inStock ?? base;
  const isLocked = (id: string) => overrides[id]?.locked ?? false;
  const outCount = PALETTE.filter((c) => !isStock(c.id, c.inStock) && (usedCounts.get(c.id) ?? 0) > 0).length;
  const lockedCount = PALETTE.filter((c) => isLocked(c.id)).length;

  const colors = PALETTE.filter((c) => {
    const used = usedCounts.get(c.id) ?? 0;
    if (filter === 'used') return used > 0;
    if (filter === 'locked') return isLocked(c.id);
    if (filter === 'out') return !isStock(c.id, c.inStock);
    return true;
  });

  return (
    <div className="page color-page">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">COLOR MATCHING</p>
          <h1>配色与色卡</h1>
          <p className="page-desc">贴图/Lab 颜色量化到现有颗粒色卡；锁定颜色会在重新量化和缺货替换时保留。</p>
        </div>
        <div className="actions">
          <Button onClick={() => setPage('voxel')}>← 体素</Button>
          <Button onClick={() => setPage('instructions')}>图纸 →</Button>
          <Button variant="primary" onClick={() => void apply()}>应用配色并重新合砖</Button>
        </div>
      </div>

      <div className="stat-grid four">
        <Stat label="使用颜色" value={usedCounts.size} tone="accent" />
        <Stat label="锁定颜色" value={lockedCount} hint="重新量化时保护" />
        <Stat label="在用缺货色" value={outCount} tone={outCount ? 'warn' : 'good'} hint={outCount ? '将换最近在库色' : '无缺货冲突'} />
        <Stat label="自动缺货替换" value={project.settings.autoReplaceOutOfStock ? '开启' : '关闭'} tone={project.settings.autoReplaceOutOfStock ? 'good' : 'default'} />
      </div>

      <div className="color-layout">
        <Card title="配色规则" subtitle="锁定、库存和最近色替换">
          <Toggle
            label="缺货自动换最近色"
            hint="使用加权 RGB/Lab 近邻；锁定色除外"
            checked={project.settings.autoReplaceOutOfStock}
            onChange={(v) => saveProject({ ...project, settings: { ...project.settings, autoReplaceOutOfStock: v } })}
          />
          <div className="legend">
            <p>🔒 <b>锁定：</b>该颜色已有区域在重新量化时保持不变，也不会被缺货替换。</p>
            <p>📦 <b>缺货：</b>关闭库存后，未锁定的在用颜色会映射到最近的在库颗粒色。</p>
          </div>
          {error && <div className="inline-error">⚠️ {error}</div>}
          {!project.grid && <p className="control-hint warn">当前工程还没有体素颜色，请先运行体素化。</p>}
        </Card>

        <Card
          title="颗粒色卡"
          action={
            <div className="filter-chips">
              {([
                ['all', '全部'],
                ['used', '已使用'],
                ['locked', '已锁定'],
                ['out', '缺货'],
              ] as const).map(([k, label]) => (
                <button key={k} className={filter === k ? 'chip active' : 'chip'} onClick={() => setFilter(k)}>{label}</button>
              ))}
            </div>
          }
        >
          <div className="palette-grid">
            {colors.map((c) => {
              const used = usedCounts.get(c.id) ?? 0;
              const stock = isStock(c.id, c.inStock);
              const locked = isLocked(c.id);
              return (
                <div key={c.id} className={`palette-card ${locked ? 'locked' : ''} ${!stock ? 'out' : ''}`}>
                  <div className="swatch" style={{ background: c.hex }}>
                    {locked && <span className="lock-mark">🔒</span>}
                    {!stock && <span className="out-mark">缺货</span>}
                  </div>
                  <div className="palette-info">
                    <b>{c.name}</b>
                    <small>{c.id}{used ? ` · ${formatNumber(used)} 粒` : ''}</small>
                  </div>
                  <div className="palette-actions">
                    <button className={locked ? 'mini-btn active' : 'mini-btn'} onClick={() => updateOverride(c.id, { locked: !locked })}>
                      {locked ? '已锁' : '锁定'}
                    </button>
                    <button
                      className={stock ? 'mini-btn good' : 'mini-btn warn'}
                      onClick={() => updateOverride(c.id, { inStock: !stock })}
                    >
                      {stock ? '在库' : '缺货'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
