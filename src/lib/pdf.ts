import { jsPDF } from 'jspdf';
import type { Project } from '../types';
import { BRICK_TYPE_MAP, PALETTE_MAP } from './palette';
import { downloadBlob } from './utils';
import { renderBricksDataUrl } from './thumbnail';

const PAGE_W = 1240;
const PAGE_H = 1754;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface LayerRow {
  partNo: string;
  name: string;
  colorName: string;
  hex: string;
  qty: number;
  support: boolean;
}

export function layerRows(project: Project, layer: number): LayerRow[] {
  const map = new Map<string, LayerRow>();
  for (const b of project.bricks.filter((x) => x.y === layer)) {
    const key = `${b.typeId}|${b.colorId}|${b.support ? 's' : 'n'}`;
    const existing = map.get(key);
    if (existing) existing.qty++;
    else {
      const t = BRICK_TYPE_MAP[b.typeId];
      const c = PALETTE_MAP[b.colorId];
      map.set(key, {
        partNo: t?.partNo ?? b.typeId,
        name: t?.name ?? b.typeId,
        colorName: c?.name ?? b.colorId,
        hex: c?.hex ?? '#999',
        qty: 1,
        support: !!b.support,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.partNo.localeCompare(b.partNo));
}

async function renderPage(
  project: Project,
  layer: number,
  imageUrl: string,
  rows: LayerRow[],
  pageIndex: number,
  pageCountForLayer: number,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  ctx.fillStyle = '#172033';
  ctx.font = '700 42px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillText(project.name, 56, 72);
  ctx.font = '500 26px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillStyle = '#5d6b82';
  ctx.fillText(`搭建图纸 · 第 ${layer + 1} / ${project.stats?.layerCount ?? '?'} 层`, 56, 116);
  ctx.textAlign = 'right';
  ctx.fillText(`BrickForge 砖构工坊`, PAGE_W - 56, 72);
  ctx.textAlign = 'left';

  // Viewport card.
  const cardX = 56;
  const cardY = 146;
  const cardW = PAGE_W - 112;
  const cardH = 760;
  ctx.fillStyle = '#eef2f7';
  roundRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.fill();
  const img = await loadImage(imageUrl);
  const pad = 28;
  const scale = Math.min((cardW - pad * 2) / img.width, (cardH - pad * 2) / img.height);
  const iw = img.width * scale;
  const ih = img.height * scale;
  ctx.drawImage(img, cardX + (cardW - iw) / 2, cardY + (cardH - ih) / 2, iw, ih);
  ctx.fillStyle = 'rgba(23,32,51,.72)';
  roundRect(ctx, cardX + 24, cardY + 22, 250, 52, 18);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 24px "Microsoft YaHei", sans-serif';
  ctx.fillText(`本步新增 ${project.bricks.filter((b) => b.y === layer).length} 块`, cardX + 46, cardY + 56);

  // Parts table.
  const tableY = 956;
  ctx.fillStyle = '#172033';
  ctx.font = '700 30px "Microsoft YaHei", sans-serif';
  ctx.fillText(pageCountForLayer > 1 ? `本层零件清单（${pageIndex + 1}/${pageCountForLayer}）` : '本层零件清单', 56, tableY);

  const columns = [56, 190, 420, 760, 1010, 1140];
  const rowH = 48;
  const firstRow = pageIndex * 15;
  const visible = rows.slice(firstRow, firstRow + 15);
  let y = tableY + 34;
  ctx.font = '700 21px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(56, y, 1128, rowH);
  ctx.fillStyle = '#43506a';
  ['设计号', '砖型', '颜色', '备注', '数量'].forEach((h, i) => ctx.fillText(h, columns[i] + 14, y + 32));
  y += rowH;

  ctx.font = '500 21px "Microsoft YaHei", sans-serif';
  visible.forEach((r, idx) => {
    ctx.fillStyle = idx % 2 ? '#fafbfd' : '#ffffff';
    ctx.fillRect(56, y, 1128, rowH);
    ctx.strokeStyle = '#e3e8f0';
    ctx.strokeRect(56, y, 1128, rowH);
    ctx.fillStyle = '#172033';
    ctx.fillText(r.partNo, columns[0] + 14, y + 31);
    ctx.fillText(r.name, columns[1] + 14, y + 31);
    ctx.fillStyle = r.hex;
    roundRect(ctx, columns[2] + 14, y + 11, 28, 28, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.18)';
    ctx.stroke();
    ctx.fillStyle = '#172033';
    ctx.fillText(r.colorName, columns[2] + 54, y + 31);
    ctx.fillStyle = r.support ? '#c2410c' : '#2f855a';
    ctx.fillText(r.support ? '自动支撑' : '成品砖', columns[3] + 14, y + 31);
    ctx.fillStyle = '#172033';
    ctx.font = '800 23px ui-monospace, monospace';
    ctx.fillText(`×${r.qty}`, columns[4] + 14, y + 32);
    ctx.font = '500 21px "Microsoft YaHei", sans-serif';
    y += rowH;
  });

  if (!rows.length) {
    ctx.fillStyle = '#718096';
    ctx.fillText('本层没有砖', 70, y + 40);
  }

  ctx.fillStyle = '#8a96aa';
  ctx.font = '400 18px "Microsoft YaHei", sans-serif';
  ctx.fillText('提示：橙色线框/条目为结构支撑；完整零件清单请导出 CSV。', 56, PAGE_H - 48);
  return canvas;
}

export async function exportInstructionsPdf(
  project: Project,
  captureLayer?: (layer: number) => string,
): Promise<void> {
  if (!project.bricks.length) throw new Error('还没有砖型方案，请先完成体素化与合砖');
  const layers = [...new Set(project.bricks.map((b) => b.y))].sort((a, b) => a - b);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const fresh = project.bricks.filter((b) => b.y === layer);
    const ghost = project.bricks.filter((b) => b.y < layer);
    let imageUrl: string;
    if (captureLayer) {
      imageUrl = captureLayer(layer);
    } else {
      imageUrl = renderBricksDataUrl(fresh, {
        width: 1200,
        height: 760,
        ghost: ghost.length > 16000 ? undefined : ghost,
        basePlateSize: project.grid ? { w: project.grid.nx, d: project.grid.nz } : undefined,
      });
    }

    const rows = layerRows(project, layer);
    const tablePages = Math.max(1, Math.ceil(rows.length / 15));
    for (let p = 0; p < tablePages; p++) {
      const canvas = await renderPage(project, layer, imageUrl, rows, p, tablePages);
      const data = canvas.toDataURL('image/jpeg', 0.92);
      if (li > 0 || p > 0) pdf.addPage('a4', 'portrait');
      pdf.addImage(data, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    }
  }

  const blob = pdf.output('blob');
  downloadBlob(blob, `${project.name}-分步搭建图纸.pdf`);
}
