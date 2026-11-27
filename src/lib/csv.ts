import type { Project } from '../types';
import { BRICK_TYPE_MAP, PALETTE_MAP } from './palette';
import { downloadBlob } from './utils';

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function partsCsv(project: Project, layer?: number): string {
  const rows: Array<Array<string | number>> = [
    ['零件编号', '砖型', '宽(凸点)', '深(凸点)', '颜色ID', '颜色名称', '层数', '数量', '类型'],
  ];

  const counts = new Map<string, number>();
  for (const b of project.bricks) {
    if (layer != null && b.y !== layer) continue;
    const key = [b.typeId, b.colorId, b.support ? 'support' : 'normal', b.y].join('|');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const [key, qty] of counts) {
    const [typeId, colorId, kind, y] = key.split('|');
    const type = BRICK_TYPE_MAP[typeId];
    const color = PALETTE_MAP[colorId];
    rows.push([
      type?.partNo ?? typeId,
      type?.name ?? typeId,
      type?.w ?? '',
      type?.d ?? '',
      colorId,
      color?.name ?? colorId,
      Number(y) + 1,
      qty,
      kind === 'support' ? '自动支撑' : '成品砖',
    ]);
  }

  if (layer == null) {
    rows.push([]);
    const total = project.partCounts.reduce((s, p) => s + p.quantity, 0);
    rows.push(['合计', '', '', '', '', '', '', total, '']);
  } else {
    const total = project.bricks.filter((b) => b.y === layer).length;
    rows.push([]);
    rows.push(['本步新增合计', '', '', '', '', '', layer + 1, total, '']);
  }

  return '﻿' + rows.filter((r) => r.length).map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function exportPartsCsv(project: Project): void {
  downloadBlob(new Blob([partsCsv(project)], { type: 'text/csv;charset=utf-8' }), `${project.name}-零件清单.csv`);
}

export function exportStepCsv(project: Project, layer: number): void {
  downloadBlob(
    new Blob([partsCsv(project, layer)], { type: 'text/csv;charset=utf-8' }),
    `${project.name}-第${layer + 1}层清单.csv`,
  );
}
