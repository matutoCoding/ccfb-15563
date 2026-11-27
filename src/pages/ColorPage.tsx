import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { nearestAvailableColor, SUPPORT_COLOR_ID } from '../core/palette';
import { bricksToRender, BrickView } from '../components/BrickView';
import type { Brick } from '../core/types';

export function ColorPage() {
  const orders = useStore((s) => s.orders);
  const currentId = useStore((s) => s.currentId);
  const palette = useStore((s) => s.palette);
  const locked = useStore((s) => s.lockedColorIds);
  const { toggleColorLock, toggleOutOfStock, updateOrder } = useStore();
  const nav = useNavigate();

  const order = orders.find((o) => o.id === currentId) ?? null;
  const result = order?.result;

  // 缺货换色后的预览砖表(不落库,确认后保存)
  const preview = useMemo(() => {
    if (!result) return null;
    const remap = new Map<string, string>();
    for (const c of palette) {
      if (c.outOfStock && !locked.has(c.id)) {
        remap.set(c.id, nearestAvailableColor(c.id, palette, locked));
      }
    }
    const bricks: Brick[] = result.bricks.map((b) => ({
      ...b,
      colorId: remap.get(b.colorId) ?? b.colorId
    }));
    const replaced = [...remap.entries()].filter(([a, b2]) => a !== b2);
    return { bricks, replaced };
  }, [result, palette, locked]);

  const usage = useMemo(() => {
    if (!preview) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const b of preview.bricks) m.set(b.colorId, (m.get(b.colorId) ?? 0) + 1);
    return m;
  }, [preview]);

  const saveRemap = async () => {
    if (!order || !result || !preview) return;
    await updateOrder(order.id, { result: { ...result, bricks: preview.bricks } });
    alert('缺货换色已保存到方案');
  };

  if (!result) {
    return <Empty go={() => nav('/voxel')} />;
  }

  return (
    <div>
      <h2 className="page-title">配色</h2>
      <p className="page-sub">贴图颜色已量化到颗粒色卡;锁定的颜色不参与自动替换,缺货色自动换最近色</p>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>色卡({palette.length} 色)</h3>
          <table>
            <thead><tr><th>颜色</th><th>名称/色号</th><th>用量</th><th>锁定</th><th>缺货</th></tr></thead>
            <tbody>
              {palette.map((c) => {
                const isLocked = locked.has(c.id);
                return (
                  <tr key={c.id} style={{ opacity: c.outOfStock && !isLocked ? 0.55 : 1 }}>
                    <td><span className="swatch" style={{ background: `rgb(${c.rgb.join(',')})` }} /></td>
                    <td>{c.name}<div className="muted mono" style={{ fontSize: 10 }}>{c.id}{c.id === SUPPORT_COLOR_ID ? ' · 支撑专用' : ''}</div></td>
                    <td>{usage.get(c.id) ?? 0} 块</td>
                    <td>
                      <span className={`pill ${isLocked ? 'on' : ''}`} onClick={() => toggleColorLock(c.id)}>
                        {isLocked ? '已锁定' : '锁定'}
                      </span>
                    </td>
                    <td>
                      <span className={`pill ${c.outOfStock ? 'on' : ''}`}
                        style={c.outOfStock ? { background: 'var(--warn)', borderColor: 'var(--warn)' } : undefined}
                        onClick={() => toggleOutOfStock(c.id)}>
                        {c.outOfStock ? '缺货' : '有货'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {preview && preview.replaced.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="issue cantilever">
                缺货自动替换:{preview.replaced.map(([from, to]) =>
                  `${palette.find((c) => c.id === from)?.name} → ${palette.find((c) => c.id === to)?.name}`).join(';')}
              </div>
              <button onClick={saveRemap}>确认替换并保存</button>
            </div>
          )}
        </div>

        <div>
          <BrickView bricks={bricksToRender(preview!.bricks, palette)} dims={result.dims} />
          <div className="card" style={{ marginTop: 14 }}>
            <b>量化说明</b>
            <ul className="muted" style={{ fontSize: 12, lineHeight: 1.8, paddingLeft: 18, marginBottom: 0 }}>
              <li>采用 redmean 感知色差,比纯欧氏距离更贴近人眼判断</li>
              <li>同色体素缓存匹配,十万级体素量化在百毫秒内完成</li>
              <li>锁定色即使缺货也强制保留,由设计师决定是否手动调整</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Empty({ go }: { go: () => void }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 60 }}>
      <p className="muted">当前订单还没有转换结果</p>
      <button onClick={go}>去体素化</button>
    </div>
  );
}
