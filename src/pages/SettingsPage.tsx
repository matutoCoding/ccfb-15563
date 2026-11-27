import { useEffect, useRef, useState } from 'react';
import { useStudio } from '../state/store';
import { Badge, Button, Card, Stat } from '../components/ui';
import { webgpuAvailable } from '../lib/gpuVoxelizer';
import { runConversion } from '../lib/pipeline';
import { createProject } from '../lib/projectIO';
import { projectToJson } from '../lib/projectIO';
import { downloadText, formatNumber, formatSeconds } from '../lib/utils';

export default function SettingsPage() {
  const { orders, projects, currentProject, exportProject, importProjectFile, setPage } = useStudio();
  const [gpuInfo, setGpuInfo] = useState<string>('检测中…');
  const [bench, setBench] = useState<{ ms: number; bricks: number; voxels: number } | null>(null);
  const [benchBusy, setBenchBusy] = useState(false);
  const importRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!webgpuAvailable()) {
        setGpuInfo('当前浏览器未暴露 navigator.gpu；系统会自动使用 CPU 回退。建议最新版 Chrome/Edge。');
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) {
          setGpuInfo('未获取到 WebGPU 适配器，将使用 CPU 回退。');
          return;
        }
        const info = (adapter as GPUAdapter & { info?: { vendor?: string; architecture?: string; description?: string } }).info;
        if (!cancelled) {
          setGpuInfo(info ? `${info.vendor ?? 'GPU'} · ${info.architecture ?? ''} ${info.description ?? ''}` : 'WebGPU 适配器已连接，可使用 WGSL 计算着色器。');
        }
      } catch (err) {
        if (!cancelled) setGpuInfo(`WebGPU 初始化异常：${(err as Error).message}，将使用 CPU 回退。`);
      }
    }
    void check();
    return () => { cancelled = true; };
  }, []);

  const runBenchmark = async () => {
    setBenchBusy(true);
    try {
      const p = createProject('bench', '性能自测猫', 'cat');
      p.settings.resolution = 96;
      const result = await runConversion(p, null);
      setBench({ ms: result.stats.totalMs ?? 0, bricks: result.bricks.length, voxels: result.stats.voxelCount });
    } finally {
      setBenchBusy(false);
    }
  };

  const exportAll = () => {
    const payload = {
      app: 'brickforge-all',
      version: 1,
      exportedAt: new Date().toISOString(),
      orders,
      projects: Object.values(projects).map((p) => JSON.parse(projectToJson(p))),
    };
    downloadText(JSON.stringify(payload), `brickforge-全部数据-${new Date().toISOString().slice(0, 10)}.json`);
  };

  return (
    <div className="page settings-page">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>设置</h1>
          <p className="page-desc">WebGPU 状态、颗粒工艺参数、性能自测和本地工程数据管理。</p>
        </div>
      </div>

      <div className="settings-grid">
        <Card title="渲染与计算" subtitle="体素化使用 WGSL compute；不可用时自动回退 CPU">
          <div className="gpu-status">
            <span className={`status-dot ${webgpuAvailable() ? 'good' : 'warn'}`} />
            <div>
              <b>{webgpuAvailable() ? 'WebGPU 可用' : 'WebGPU 不可用'}</b>
              <p>{gpuInfo}</p>
            </div>
            <Badge tone={webgpuAvailable() ? 'good' : 'warn'}>{webgpuAvailable() ? 'WGSL Compute' : 'CPU Fallback'}</Badge>
          </div>
          <div className="setting-line"><span>塑料渲染</span><b>ACES 色调 · Clearcoat · PCF 软阴影</b></div>
          <div className="setting-line"><span>凸点规格</span><b>半径 2.4 mm · 高 1.44 mm（按 8 mm 齿距缩放）</b></div>
          <div className="setting-line"><span>标准砖高</span><b>9.6 mm = 1.2 × 齿距</b></div>
          <Button variant="primary" disabled={benchBusy} onClick={() => void runBenchmark()}>
            {benchBusy ? '正在跑 96 分辨率自测…' : '运行转换性能自测'}
          </Button>
          {bench && (
            <div className="bench-result">
              <Stat label="总耗时" value={formatSeconds(bench.ms)} tone={bench.ms <= 10000 ? 'good' : 'bad'} hint="目标 ≤ 10 秒" />
              <Stat label="材料体素" value={formatNumber(bench.voxels)} />
              <Stat label="合并砖数" value={formatNumber(bench.bricks)} />
            </div>
          )}
        </Card>

        <Card title="当前工程默认策略" subtitle={currentProject?.name ?? '尚未打开工程'}>
          {currentProject ? (
            <>
              <div className="setting-line"><span>内部掏空</span><Badge tone={currentProject.settings.hollow ? 'good' : 'warn'}>{currentProject.settings.hollow ? '开启' : '关闭'}</Badge></div>
              <div className="setting-line"><span>分辨率</span><b>{currentProject.settings.resolution} 体素</b></div>
              <div className="setting-line"><span>壳厚</span><b>{currentProject.settings.shellThickness} 颗粒</b></div>
              <div className="setting-line"><span>自动支撑</span><Badge tone={currentProject.settings.autoSupport ? 'good' : 'warn'}>{currentProject.settings.autoSupport ? '开启' : '关闭'}</Badge></div>
              <p className="control-hint">参数修改已集中在“体素化”和“配色”页，避免不同页面状态不一致。</p>
            </>
          ) : (
            <p className="muted">从订单中打开工程后可调整转换策略。</p>
          )}
          <div className="actions left">
            <Button onClick={() => setPage('voxel')}>前往体素参数</Button>
            <Button onClick={() => setPage('color')}>前往配色规则</Button>
          </div>
        </Card>

        <Card title="工程与订单数据" subtitle="数据保存在此浏览器 localStorage/Indexed 风格缓存中，可导出备份">
          <div className="data-actions">
            <Button onClick={() => currentProject && exportProject()} disabled={!currentProject}>导出当前工程 JSON</Button>
            <Button onClick={exportAll}>导出全部订单与工程</Button>
            <Button onClick={() => importRef.current?.click()}>导入工程 JSON</Button>
            <input ref={importRef} type="file" accept=".json" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                try { await importProjectFile(f); } catch (err) { alert((err as Error).message); }
              }
              e.target.value = '';
            }} />
            <Button variant="danger" onClick={() => {
              if (confirm('清空本机所有订单和工程缓存？此操作不可撤销，建议先导出全部数据。')) {
                localStorage.clear();
                location.reload();
              }
            }}>清空本地数据</Button>
          </div>
          <p className="control-hint">工程文件包含 Base64 体素网格、砖方案、色卡覆盖和统计信息，可跨设备导入。</p>
        </Card>

        <Card title="结构验收口径" subtitle="这是本系统最重要的输出约束">
          <ul className="accept-list">
            <li>✅ 除底层与底板接触外，每块砖至少有一个凸点与下层砖咬合。</li>
            <li>✅ 自动支撑按最短空层路径生成 1×1 支撑柱，直到底层或已有砖。</li>
            <li>✅ 面积大于 1 且只有一个下咬合点的砖，会尝试补第二个支撑点。</li>
            <li>⚠️ 1×1 砖物理上只有一个凸点，系统会标为弱连接而不是隐藏风险。</li>
            <li>✅ 合砖评分惩罚同尺寸重叠，奖励跨过下层砖缝，形成交错跑缝。</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
