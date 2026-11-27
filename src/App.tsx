import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useStore } from './state/store';
import { OrdersPage } from './pages/OrdersPage';
import { ImportPage } from './pages/ImportPage';
import { VoxelPage } from './pages/VoxelPage';
import { ColorPage } from './pages/ColorPage';
import { InstructionsPage } from './pages/InstructionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { BusyMask } from './components/BusyMask';

const NAV = [
  { to: '/orders', label: '订单列表' },
  { to: '/import', label: '模型导入' },
  { to: '/voxel', label: '体素化' },
  { to: '/color', label: '配色' },
  { to: '/instructions', label: '搭建图纸' },
  { to: '/settings', label: '设置' }
];

export function App() {
  const loadOrders = useStore((s) => s.loadOrders);
  const gpu = useStore((s) => s.gpuAvailable);
  const setGpu = useStore((s) => s.setGpu);
  const currentId = useStore((s) => s.currentId);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!('gpu' in navigator)) { setGpu(false); return; }
      try {
        const a = await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter();
        if (alive) setGpu(!!a);
      } catch { if (alive) setGpu(false); }
    })();
    return () => { alive = false; };
  }, [setGpu]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">BrickForge<small>积木定制转换工作台</small></div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            {n.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className={`gpu-badge ${gpu === null ? '' : gpu ? 'ok' : 'no'}`}>
          {gpu === null ? 'GPU 检测中…' : gpu ? 'WebGPU 已就绪' : 'WebGPU 不可用 · CPU 模式'}
        </div>
        {currentId && <div className="gpu-badge" style={{ marginTop: 6 }}>当前订单 {currentId.slice(0, 10)}</div>}
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/orders" replace />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/voxel" element={<VoxelPage />} />
          <Route path="/color" element={<ColorPage />} />
          <Route path="/instructions" element={<InstructionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <BusyMask />
    </div>
  );
}
