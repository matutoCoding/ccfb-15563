import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { LoadedModelSource, Order, PageKey, Project } from '../types';
import { createOrder, createProject, deserializeProject, parseProjectJson, projectToJson } from '../lib/projectIO';
import { downloadText, uid } from '../lib/utils';
import { runConversion } from '../lib/pipeline';

const ORDERS_KEY = 'brickforge.orders.v1';
const PROJECTS_KEY = 'brickforge.projects.v1';

interface StudioContextValue {
  page: PageKey;
  setPage: (p: PageKey) => void;
  orders: Order[];
  currentOrderId: string | null;
  currentOrder: Order | null;
  currentProject: Project | null;
  projects: Record<string, Project>;
  busy: string | null;
  setBusy: (v: string | null) => void;
  createOrderWithProject: (input?: Partial<Order>, template?: 'cat' | 'house') => string;
  updateOrder: (id: string, patch: Partial<Order>) => void;
  deleteOrder: (id: string) => void;
  openOrder: (id: string, page?: PageKey) => void;
  saveProject: (p: Project) => void;
  updateCurrentProject: (updater: (p: Project) => Project) => void;
  exportProject: (id?: string) => void;
  importProjectFile: (file: File) => Promise<void>;
  getSource: (projectId: string) => LoadedModelSource | null;
  setSource: (projectId: string, source: LoadedModelSource) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

function loadOrders(): Order[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    if (raw) return JSON.parse(raw) as Order[];
  } catch (err) {
    console.warn('订单读取失败', err);
  }
  const catOrder = createOrder({
    code: 'BF-DEMO-001',
    customer: '示例客户 · 小林',
    petName: '橘座',
    title: '坐着的橘猫摆件',
    status: '处理中',
    quantity: 1,
    budget: 1280,
    note: '客户要求稳，尾巴和耳朵不能一碰就散。',
  });
  const houseOrder = createOrder({
    code: 'BF-DEMO-002',
    customer: '门店样例',
    petName: '—',
    title: '小房子笔筒摆件',
    status: '新订单',
    quantity: 2,
    budget: 960,
    note: '红屋顶、米黄墙，需要分步图纸。',
  });
  return [catOrder, houseOrder];
}

function loadProjects(): Record<string, Project> {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return {};
    const arr = JSON.parse(raw) as unknown[];
    return Object.fromEntries(
      arr.map((d) => {
        const p = deserializeProject(d);
        return [p.orderId, p];
      }),
    );
  } catch (err) {
    console.warn('工程缓存读取失败', err);
    return {};
  }
}

const PAGE_KEYS: PageKey[] = ['orders', 'import', 'voxel', 'color', 'instructions', 'settings'];

function pageFromHash(): PageKey {
  const h = window.location.hash.replace(/^#\/?/, '') as PageKey;
  return PAGE_KEYS.includes(h) ? h : 'orders';
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [page, setPageState] = useState<PageKey>(pageFromHash);
  const [orders, setOrders] = useState<Order[]>(loadOrders);
  const [projects, setProjects] = useState<Record<string, Project>>(loadProjects);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(orders[0]?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const sourceCache = useRef(new Map<string, LoadedModelSource>());

  const setPage = useCallback((next: PageKey) => {
    setPageState(next);
    const hash = `#/${next}`;
    if (window.location.hash !== hash) window.location.hash = hash;
  }, []);

  useEffect(() => {
    const onHash = () => setPageState(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
    } catch (err) {
      console.warn('订单保存失败', err);
    }
  }, [orders]);

  useEffect(() => {
    try {
      // Serialize through the base64 DTO so typed arrays survive storage.
      const serialized = Object.values(projects).map((p) => JSON.parse(projectToJson(p)));
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(serialized));
    } catch (err) {
      console.warn('工程自动缓存失败（不影响导出文件）', err);
    }
  }, [projects]);

  useEffect(() => {
    let cancelled = false;
    const missing = orders.filter((o) => {
      const p = projects[o.id];
      return !p?.grid && (o.code === 'BF-DEMO-001' || o.code === 'BF-DEMO-002');
    });
    if (!missing.length) return;
    setBusy('正在生成内置猫和小房子样例…');
    Promise.all(
      missing.map(async (o) => {
        const kind = o.code === 'BF-DEMO-001' ? 'cat' : 'house';
        const p = createProject(o.id, o.title, kind);
        const result = await runConversion(p, null);
        return { id: o.id, project: { ...p, ...result } satisfies Project };
      }),
    )
      .then((items) => {
        if (cancelled) return;
        setProjects((ps) => {
          const next = { ...ps };
          for (const item of items) next[item.id] = item.project;
          return next;
        });
      })
      .catch((err) => console.error('内置样例生成失败', err))
      .finally(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
    };
    // Run once after first local state hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createOrderWithProject = useCallback((input?: Partial<Order>, template?: 'cat' | 'house') => {
    const order = createOrder(input);
    const kind = template ?? 'project';
    const project = createProject(order.id, order.title, kind);
    if (template) project.name = template === 'cat' ? '坐着的猫' : '小房子';
    setOrders((os) => [order, ...os]);
    setProjects((ps) => ({ ...ps, [order.id]: project }));
    setCurrentOrderId(order.id);

    if (template) {
      setBusy(template === 'cat' ? '正在生成坐姿猫并转换…' : '正在生成小房子并转换…');
      void runConversion(project, null)
        .then((result) => {
          setProjects((ps) => {
            const current = ps[order.id] ?? project;
            return { ...ps, [order.id]: { ...current, ...result } };
          });
        })
        .catch((err) => console.error('模板工程生成失败', err))
        .finally(() => setBusy(null));
    }
    return order.id;
  }, []);

  const updateOrder = useCallback((id: string, patch: Partial<Order>) => {
    setOrders((os) => os.map((o) => (o.id === id ? { ...o, ...patch, updatedAt: Date.now() } : o)));
    setProjects((ps) => {
      const p = ps[id];
      if (!p || patch.title == null) return ps;
      return { ...ps, [id]: { ...p, name: patch.title, updatedAt: Date.now() } };
    });
  }, []);

  const deleteOrder = useCallback((id: string) => {
    setOrders((os) => os.filter((o) => o.id !== id));
    setProjects((ps) => {
      const next = { ...ps };
      delete next[id];
      return next;
    });
    sourceCache.current.delete(id);
    setCurrentOrderId((cur) => (cur === id ? null : cur));
  }, []);

  const openOrder = useCallback((id: string, nextPage: PageKey = 'import') => {
    setCurrentOrderId(id);
    setPage(nextPage);
  }, [setPage]);

  const saveProject = useCallback((p: Project) => {
    const next = { ...p, updatedAt: Date.now() };
    setProjects((ps) => ({ ...ps, [p.orderId]: next }));
  }, []);

  const updateCurrentProject = useCallback(
    (updater: (p: Project) => Project) => {
      if (!currentOrderId) return;
      setProjects((ps) => {
        const p = ps[currentOrderId] ?? createProject(currentOrderId, '未命名工程');
        return { ...ps, [currentOrderId]: { ...updater(p), updatedAt: Date.now() } };
      });
    },
    [currentOrderId],
  );

  const exportProject = useCallback(
    (id?: string) => {
      const orderId = id ?? currentOrderId;
      const p = orderId ? projects[orderId] : null;
      if (!p) throw new Error('没有可导出的工程');
      downloadText(projectToJson(p), `${p.name}.brickforge.json`);
    },
    [projects, currentOrderId],
  );

  const importProjectFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const project = parseProjectJson(text);
      // Projects are keyed by orderId in this local-first workspace.
      if (!project.orderId || !orders.some((o) => o.id === project.orderId)) {
        const order = createOrder({
          id: project.orderId || uid('order'),
          title: project.name,
          customer: '导入工程',
          status: '处理中',
        });
        project.orderId = order.id;
        setOrders((os) => [order, ...os]);
      }
      setProjects((ps) => ({ ...ps, [project.orderId]: project }));
      setCurrentOrderId(project.orderId);
      setPage('voxel');
    },
    [orders],
  );

  const getSource = useCallback((projectId: string) => sourceCache.current.get(projectId) ?? null, []);
  const setSource = useCallback((projectId: string, source: LoadedModelSource) => {
    sourceCache.current.set(projectId, source);
  }, []);

  const currentOrder = useMemo(
    () => orders.find((o) => o.id === currentOrderId) ?? null,
    [orders, currentOrderId],
  );
  const currentProject = useMemo(
    () => (currentOrderId ? projects[currentOrderId] ?? null : null),
    [projects, currentOrderId],
  );

  const value: StudioContextValue = {
    page,
    setPage,
    orders,
    currentOrderId,
    currentOrder,
    currentProject,
    projects,
    busy,
    setBusy,
    createOrderWithProject,
    updateOrder,
    deleteOrder,
    openOrder,
    saveProject,
    updateCurrentProject,
    exportProject,
    importProjectFile,
    getSource,
    setSource,
  };
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio 必须在 StudioProvider 内使用');
  return ctx;
}
