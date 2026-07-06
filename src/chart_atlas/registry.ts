import type { Chart, ChartId } from './types.js';

const charts = new Map<ChartId, Chart>();

export function registerChart(c: Chart): void {
  if (charts.has(c.id)) throw new Error(`chart ${c.id} already registered`);
  charts.set(c.id, c);
}

export function getChart(id: ChartId): Chart {
  const c = charts.get(id);
  if (!c) throw new Error(`chart ${id} not registered`);
  return c;
}

export function allCharts(): readonly Chart[] {
  return [...charts.values()];
}
