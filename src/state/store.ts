import { create } from 'zustand';
import { orderDb } from './orderDb';
import { uid, type Order, type OrderResult, type OrderStatus } from '../order';
import { DEFAULT_SETTINGS } from '../core/pipeline';
import { DEFAULT_PALETTE } from '../core/palette';
import type { PaletteColor, ProjectSettings } from '../core/types';

interface AppState {
  orders: Order[];
  currentId: string | null;
  settings: ProjectSettings;
  palette: PaletteColor[];
  lockedColorIds: Set<string>;
  gpuAvailable: boolean | null;
  busy: string | null;
  loadOrders: () => Promise<void>;
  createOrder: (draft: { name: string; customer: string; note: string }) => Promise<string>;
  updateOrder: (id: string, patch: Partial<Order>) => Promise<void>;
  removeOrder: (id: string) => Promise<void>;
  setStatus: (id: string, status: OrderStatus) => Promise<void>;
  selectOrder: (id: string | null) => void;
  saveResult: (id: string, result: OrderResult, source: Order['source']) => Promise<void>;
  setSettings: (patch: Partial<ProjectSettings>) => void;
  toggleColorLock: (colorId: string) => void;
  toggleOutOfStock: (colorId: string) => void;
  setGpu: (ok: boolean) => void;
  setBusy: (msg: string | null) => void;
}

export const useStore = create<AppState>((set, get) => ({
  orders: [],
  currentId: null,
  settings: { ...DEFAULT_SETTINGS },
  palette: DEFAULT_PALETTE.map((c) => ({ ...c })),
  lockedColorIds: new Set<string>(),
  gpuAvailable: null,
  busy: null,

  async loadOrders() {
    set({ orders: await orderDb.getAll() });
  },

  async createOrder(draft) {
    const now = Date.now();
    const order: Order = {
      id: uid(), ...draft, status: '待处理',
      createdAt: now, updatedAt: now
    };
    await orderDb.put(order);
    set((s) => ({ orders: [order, ...s.orders], currentId: order.id }));
    return order.id;
  },

  async updateOrder(id, patch) {
    const order = await orderDb.get(id);
    if (!order) return;
    const next = { ...order, ...patch, updatedAt: Date.now() };
    await orderDb.put(next);
    set((s) => ({ orders: s.orders.map((o) => (o.id === id ? next : o)) }));
  },

  async removeOrder(id) {
    await orderDb.delete(id);
    set((s) => ({
      orders: s.orders.filter((o) => o.id !== id),
      currentId: s.currentId === id ? null : s.currentId
    }));
  },

  async setStatus(id, status) {
    await get().updateOrder(id, { status });
  },

  selectOrder(id) { set({ currentId: id }); },

  async saveResult(id, result, source) {
    const order = await orderDb.get(id);
    if (!order) return;
    const next: Order = {
      ...order, status: order.status === '待处理' ? '待审核' : order.status,
      source, result, updatedAt: Date.now()
    };
    await orderDb.put(next);
    set((s) => ({ orders: s.orders.map((o) => (o.id === id ? next : o)) }));
  },

  setSettings(patch) {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
  },

  toggleColorLock(colorId) {
    set((s) => {
      const next = new Set(s.lockedColorIds);
      if (next.has(colorId)) next.delete(colorId); else next.add(colorId);
      return { lockedColorIds: next };
    });
  },

  toggleOutOfStock(colorId) {
    set((s) => ({
      palette: s.palette.map((c) =>
        c.id === colorId ? { ...c, outOfStock: !c.outOfStock } : c)
    }));
  },

  setGpu(ok) { set({ gpuAvailable: ok }); },
  setBusy(msg) { set({ busy: msg }); }
}));
