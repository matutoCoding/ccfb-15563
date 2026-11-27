import { StudioProvider, useStudio } from './state/store';
import OrdersPage from './pages/OrdersPage';
import ImportPage from './pages/ImportPage';
import VoxelPage from './pages/VoxelPage';
import ColorPage from './pages/ColorPage';
import InstructionsPage from './pages/InstructionsPage';
import SettingsPage from './pages/SettingsPage';
import type { PageKey } from './types';

const NAV: Array<{ key: PageKey; icon: string; label: string; step: string }> = [
  { key: 'orders', icon: '📋', label: '订单列表', step: '01' },
  { key: 'import', icon: '📥', label: '模型导入', step: '02' },
  { key: 'voxel', icon: '🧊', label: '体素化', step: '03' },
  { key: 'color', icon: '🎨', label: '配色', step: '04' },
  { key: 'instructions', icon: '📐', label: '搭建图纸', step: '05' },
  { key: 'settings', icon: '⚙️', label: '设置', step: '06' },
];

function Shell() {
  const { page, setPage, currentOrder, currentProject, busy, exportProject } = useStudio();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">砖</div>
          <div>
            <h1>砖构工坊</h1>
            <p>BrickForge Studio</p>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`nav-item ${page === n.key ? 'active' : ''}`}
              onClick={() => setPage(n.key)}
            >
              <span className="nav-step">{n.step}</span>
              <span className="nav-icon">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-card">
          <p>结构验收线</p>
          <strong>0 悬空 · 层层咬合</strong>
          <span>10 万体素 / 10 秒转换目标</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumb">
            <span>颗粒积木定制生产台</span>
            <b>{NAV.find((n) => n.key === page)?.label}</b>
          </div>
          <div className="topbar-right">
            {currentOrder ? (
              <div className="current-order">
                <span>{currentOrder.code}</span>
                <b>{currentOrder.title}</b>
              </div>
            ) : (
              <div className="current-order muted">未选择订单</div>
            )}
            <button
              className="btn btn-default btn-sm"
              disabled={!currentProject}
              onClick={() => {
                try { exportProject(); } catch (e) { alert((e as Error).message); }
              }}
            >
              导出工程
            </button>
          </div>
        </header>

        <main className="content">
          {busy && (
            <div className="global-busy">
              <span className="spinner" />
              {busy}
            </div>
          )}
          {page === 'orders' && <OrdersPage />}
          {page === 'import' && <ImportPage />}
          {page === 'voxel' && <VoxelPage />}
          {page === 'color' && <ColorPage />}
          {page === 'instructions' && <InstructionsPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StudioProvider>
      <Shell />
    </StudioProvider>
  );
}
