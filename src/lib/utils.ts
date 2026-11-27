import type { VoxelGrid } from '../types';

export function createGrid(nx: number, ny: number, nz: number): VoxelGrid {
  const n = nx * ny * nz;
  return {
    version: 1,
    nx,
    ny,
    nz,
    kind: new Uint8Array(n),
    color: new Uint8Array(n).fill(255),
    sourceRGB: new Int32Array(n).fill(-1),
  };
}

/** x fastest, then z, then y. Layer slices stay contiguous-ish. */
export function gridIndex(g: Pick<VoxelGrid, 'nx' | 'nz'>, x: number, y: number, z: number): number {
  return x + g.nx * (z + g.nz * y);
}

export function gridIndexRaw(nx: number, nz: number, x: number, y: number, z: number): number {
  return x + nx * (z + nz * y);
}

export function inBounds(g: VoxelGrid, x: number, y: number, z: number): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < g.nx && y < g.ny && z < g.nz;
}

export function forEachVoxel(
  g: VoxelGrid,
  fn: (x: number, y: number, z: number, i: number) => void,
): void {
  for (let y = 0; y < g.ny; y++) {
    for (let z = 0; z < g.nz; z++) {
      for (let x = 0; x < g.nx; x++) {
        fn(x, y, z, gridIndexRaw(g.nx, g.nz, x, y, z));
      }
    }
  }
}

export function countKind(g: VoxelGrid, kind: 1 | 2): number {
  let n = 0;
  for (const v of g.kind) if (v === kind) n++;
  return n;
}

export function b64FromBytes(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function bytesFromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function int32ToBase64(a: Int32Array): string {
  return b64FromBytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
}

export function int32FromBase64(b64: string): Int32Array {
  const u8 = bytesFromB64(b64);
  return new Int32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, type = 'application/json'): void {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

export function uid(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function formatSeconds(ms: number | undefined): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** ICU-free grouping; some headless Chromium builds throw on Number.toLocaleString. */
export function formatNumber(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
