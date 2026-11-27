import { BRICK_TYPES } from './brickTypes';
import { buildPartList, buildSummary, buildStepDetails } from './instructions';
import type { Brick, BuildStep, PaletteColor, Vec3 } from './types';

/** 零件清单 CSV(带 BOM,Excel 直接打开不乱码) */
export function partsListCsv(bricks: Brick[], palette: PaletteColor[], orderName: string): string {
  const lines = buildPartList(bricks, palette);
  const rows = [
    ['订单', orderName],
    [],
    ['砖型', '砖型名称', '色号', '颜色', '数量(颗)', '是否支撑件'],
    ...lines.map((l) => [
      l.typeId, l.typeName, l.colorId, l.colorName, String(l.count), l.support ? '是' : '否'
    ]),
    [],
    ['合计', String(lines.reduce((s, l) => s + l.count, 0))]
  ];
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  triggerDownload(URL.createObjectURL(blob), filename);
}

export function downloadBlob(filename: string, blob: Blob) {
  triggerDownload(URL.createObjectURL(blob), filename);
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 分步搭建 PDF:封面总览 + 每步一页,带俯视层位图(色块即砖,标注砖型)。
 * 3D 视图截图通过 renderCanvas 参数传入(可选),有则附在封面。
 */
export async function buildInstructionsPdf(opts: {
  orderName: string;
  bricks: Brick[];
  steps: BuildStep[];
  palette: PaletteColor[];
  dims: Vec3;
  renderCanvas?: HTMLCanvasElement;
}): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const { orderName, bricks, steps, palette, dims, renderCanvas } = opts;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const summary = buildSummary(bricks, steps);
  const parts = buildPartList(bricks, palette);

  // ---- 封面 ----
  doc.setFontSize(20);
  doc.text('BrickForge Building Instructions', 15, 20);
  doc.setFontSize(13);
  doc.text(orderName, 15, 30);
  doc.setFontSize(11);
  let y = 42;
  const facts = [
    `总砖数: ${summary.totalBricks}(支撑件 ${summary.supportBricks})`,
    `层数: ${summary.layerCount}   搭建步骤: ${summary.stepCount}   颜色: ${summary.colorKinds} 种`,
    `成品尺寸(颗粒): ${dims.x} x ${dims.y} x ${dims.z}`
  ];
  for (const f of facts) { doc.text(f, 15, y); y += 7; }

  if (renderCanvas) {
    const img = renderCanvas.toDataURL('image/png');
    const iw = Math.min(W - 30, 120);
    doc.addImage(img, 'PNG', 15, y + 2, iw, iw * renderCanvas.height / renderCanvas.width);
    y += 2 + iw * renderCanvas.height / renderCanvas.width + 8;
  }

  doc.setFontSize(13);
  doc.text('零件清单', 15, y);
  y += 7;
  doc.setFontSize(10);
  doc.text('砖型', 15, y); doc.text('颜色', 55, y); doc.text('数量', 150, y);
  y += 6;
  for (const p of parts) {
    if (y > 280) { doc.addPage(); y = 20; }
    doc.setFillColor(p.rgb[0], p.rgb[1], p.rgb[2]);
    doc.rect(48, y - 4, 5, 5, 'F');
    doc.text(`${p.typeId} ${p.typeName}${p.support ? ' (支撑)' : ''}`, 15, y);
    doc.text(p.colorName, 56, y);
    doc.text(String(p.count), 150, y);
    y += 6;
  }

  // ---- 分步页 ----
  const details = buildStepDetails(steps, bricks, palette);
  const typeName = new Map(BRICK_TYPES.map((t) => [t.id, t.name]));
  for (const d of details) {
    doc.addPage();
    const s = d.step;
    doc.setFontSize(14);
    doc.text(`Step ${s.index + 1} / ${steps.length} — 第 ${s.layer + 1} 层`, 15, 18);
    doc.setFontSize(10);
    doc.text(`本步新增 ${d.newBrickCount} 块砖`, 15, 26);

    // 俯视图:整层网格 + 本步砖高亮
    const gridX = 15, gridY = 32, gridW = Math.min(W - 30, 140);
    const cell = Math.min(gridW / dims.x, gridW / dims.y, 12);
    const gw = cell * dims.x, gh = cell * dims.y;
    const colorMap = new Map(palette.map((c) => [c.id, c.rgb]));
    const newIds = new Set(s.brickIds);
    doc.setDrawColor(210);
    for (const b of bricks) {
      if (b.z !== s.layer) continue;
      const isNew = newIds.has(b.id);
      const rgb = colorMap.get(b.colorId) ?? [128, 128, 128];
      doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      const bx = gridX + b.x * cell, by = gridY + b.y * cell;
      doc.rect(bx, by, b.nx * cell, b.ny * cell, isNew ? 'FD' : 'F');
      if (isNew) {
        doc.setDrawColor(20);
        doc.setLineWidth(0.5);
        doc.rect(bx, by, b.nx * cell, b.ny * cell, 'S');
        doc.setLineWidth(0.2);
        doc.setTextColor(20);
        if (cell >= 6) doc.text(typeName.get(b.typeId) ?? b.typeId, bx + 0.8, by + cell * 0.7);
      }
    }
    doc.setDrawColor(80);
    doc.rect(gridX, gridY, gw, gh, 'S');

    // 本步零件
    let py = gridY + gh + 10;
    doc.setFontSize(11);
    doc.text('本步零件', 15, py);
    py += 6;
    doc.setFontSize(10);
    for (const p of d.parts) {
      doc.text(`${p.typeId} ${p.typeName} x${p.count}  ${p.colorName}`, 15, py);
      py += 6;
    }
    doc.setTextColor(0);
  }

  return doc.output('blob');
}
