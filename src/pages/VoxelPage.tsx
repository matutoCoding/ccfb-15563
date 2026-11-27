import { useState } from 'react';
import { useStudio } from '../state/store';
import { Badge, Button, Card, Stat, Toggle } from '../components/ui';
import StudioViewer from '../components/StudioViewer';
import { BRICK_TYPES } from '../lib/palette';
import { webgpuAvailable } from '../lib/gpuVoxelizer';
import { runConversion } from '../lib/pipeline';
import { formatNumber, formatSeconds } from '../lib/utils';
import type { ConvertSettings } from '../types';

export default function VoxelPage() {
  const { currentProject, currentOrder, saveProject, getSource, setPage, busy, setBusy } = useStudio();
  const [error, setError] = useState<string | null>(null);
  const gpu = webgpuAvailable();

  if (!currentProject || !currentOrder) {
    return <MissingProject onOrders={() => setPage('orders')} />;
  }
  const project = currentProject;
  const s = project.settings;
  const sourceReady = project.sourceKind === 'cat' || project.sourceKind === 'house' || !!getSource(project.id);

  const patch = (p: Partial<ConvertSettings>) => {
    saveProject({ ...project, settings: { ...s, ...p } });
  };

  const toggleType = (id: string) => {
    const allowed = new Set(s.allowedTypeIds);
    if (allowed.has(id)) allowed.delete(id);
    else allowed.add(id);
    if (!allowed.size) allowed.add('b11');
    patch({ allowedTypeIds: [...allowed] });
  };

  const run = async () => {
    setError(null);
    setBusy(gpu ? 'WebGPU 计算着色器体素化 + 合砖中…' : 'WebGPU 不可用，使用 CPU 保守体素化…');
    try {
      const source = getSource(project.id);
      const result = await runConversion(project, source);
      saveProject({ ...project, ...result });
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const perfOk = project.stats && project.stats.totalMs != null && project.stats.totalMs <= 10000;

  return (
    <div className="page voxel-page">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">VOXELIZE & MERGE</p>
          <h1>体素化与合砖</h1>
          <p className="page-desc">计算着色器按颗粒间距切分模型，保留足够厚的壳，再合并为真实砖型并交错咬合。</p>
        </div>
        <div className="actions">
          <Button onClick={() => setPage('import')}>← 导入</Button>
          <Button onClick={() => setPage('color')}>配色 →</Button>
          <Button variant="primary" disabled={!!busy} onClick={() => void run()}>
            {project.bricks.length ? '重新运行转换' : '一键体素化 + 合砖'}
          </Button>
        </div>
      </div>

      <div className="pipeline-grid">
        <Card title="体素参数" subtitle="分辨率是最长边的体素数；薄件保护默认开启">
          <div className="control-block">
            <div className="control-label">
              <span>分辨率</span>
              <b>{s.resolution} 体素</b>
            </div>
            <input
              type="range"
              min={48}
              max={128}
              step={16}
              value={s.resolution}
              onChange={(e) => patch({ resolution: Number(e.target.value) as ConvertSettings['resolution'] })}
            />
            <div className="range-marks"><span>48 快</span><span>64</span><span>80</span><span>96</span><span>128 精细</span></div>
          </div>

          <div className="control-block">
            <div className="control-label"><span>壳厚</span><b>{s.shellThickness} 颗粒</b></div>
            <input
              type="range" min={1} max={3} step={1}
              value={s.shellThickness}
              onChange={(e) => patch({ shellThickness: Number(e.target.value) as 1 | 2 | 3 })}
            />
            <p className="control-hint">内部按壳厚掏空省料；薄于壳厚的位置会完整保留，不会被侵蚀断开。</p>
          </div>

          <div className="toggle-stack">
            <Toggle label="内部掏空" hint="只保留厚壳，减少零件数量" checked={s.hollow} onChange={(v) => patch({ hollow: v })} />
            <Toggle label="薄件连接修复" hint="保守体素化 + 邻域扩张，桥接对角细缝" checked={s.repairThin} onChange={(v) => patch({ repairThin: v })} />
            <Toggle label="层间交错咬合" hint="相邻层变换长边方向并跨过砖缝" checked={s.staggerBonds} onChange={(v) => patch({ staggerBonds: v })} />
            <Toggle label="自动加悬空支撑" hint="为完全没有下咬合的砖生成最短支撑柱" checked={s.autoSupport} onChange={(v) => patch({ autoSupport: v })} />
            <Toggle label="补强单凸点连接" hint="给面积大于 1 且仅一點咬合的砖补第二个支撑点；零件更多" checked={s.reinforceSingleStuds} onChange={(v) => patch({ reinforceSingleStuds: v })} />
          </div>

          <div className="type-picker">
            <span>参与合并的实际砖型</span>
            <div className="type-chips">
              {BRICK_TYPES.map((t) => (
                <button
                  key={t.id}
                  className={s.allowedTypeIds.includes(t.id) ? 'chip active' : 'chip'}
                  onClick={() => toggleType(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {!sourceReady && (
            <p className="control-hint warn">刷新后外部模型缓存已释放；可调整参数重新合砖/配色，若要按新分辨率体素化请重新导入原文件。</p>
          )}
          {error && <div className="inline-error">⚠️ {error}</div>}
        </Card>

        <Card
          title="三维体素/砖方案预览"
          subtitle="塑料材质、凸点和阴影；可拖动旋转检查侧面与背面"
          action={<Badge tone={gpu ? 'good' : 'warn'}>{gpu ? 'WebGPU Compute 可用' : 'WebGPU 不可用 · CPU 回退'}</Badge>}
          className="viewer-card"
        >
          <StudioViewer
            bricks={project.bricks}
            basePlateSize={project.grid ? { w: project.grid.nx, d: project.grid.nz } : undefined}
            fitToken={project.id + project.stats?.brickCount}
            height={520}
          />
        </Card>
      </div>

      <div className="stat-grid five">
        <Stat label="材料体素" value={formatNumber(project.stats?.voxelCount ?? 0)} hint={project.grid ? `${project.grid.nx}×${project.grid.ny}×${project.grid.nz}` : '尚未生成'} tone="accent" />
        <Stat label="合并砖数" value={formatNumber(project.stats?.brickCount ?? 0)} hint={`${project.stats?.layerCount ?? 0} 层`} />
        <Stat label="合砖耗时" value={formatSeconds(project.stats?.mergeMs)} hint="贪心矩形 + 咬合评分" />
        <Stat label="总转换耗时" value={formatSeconds(project.stats?.totalMs)} hint={perfOk ? '满足 ≤10 秒目标' : '运行后统计'} tone={perfOk ? 'good' : 'default'} />
        <Stat label="悬空" value={project.stats?.floatingCount ?? '—'} hint={`单凸点 ${project.stats?.singleStudCount ?? 0}`} tone={project.stats?.floatingCount ? 'bad' : 'good'} />
      </div>
    </div>
  );
}

function MissingProject({ onOrders }: { onOrders: () => void }) {
  return (
    <div className="page">
      <Card>
        <h2>还没有打开的工程</h2>
        <p>请先从订单列表创建或选择订单。</p>
        <Button variant="primary" onClick={onOrders}>前往订单列表</Button>
      </Card>
    </div>
  );
}
