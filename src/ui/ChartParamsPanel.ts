import type { App } from '@/app/app.js';
import type { AxisSpec } from '@/chart_atlas/index.js';
import { AXIS_KINDS, DEFAULT_AXES, pairingError } from '@/chart_atlas/index.js';

/**
 * Per-chart parameter editor. Everything here writes ViewState.chartParams
 * through the store — chartParams is in the tile cache key (Stage 3), so an
 * edit invalidates and recomputes, exactly like moving z0.
 *
 * For the mixed-axis chart this IS the spec's custom-chart construction:
 * pick any two coordinates as axes (latent lane, mass component, L_z,
 * energy, shape α/β) with ranges; the remaining six freeze at z0.
 */

interface FieldSpec { key: string; label: string; step: number; dflt: number }
const CHART_FIELDS: Record<string, FieldSpec[]> = {
  lz_e: [
    { key: 'Kmax', label: 'K max', step: 0.1, dflt: 2 },
    { key: 'gammaK', label: 'γ_K', step: 0.1, dflt: 2 },
    { key: 'alpha', label: 'α (frozen)', step: 0.01, dflt: Math.PI / 4 },
    { key: 'beta', label: 'β (frozen)', step: 0.01, dflt: Math.PI / 2 },
  ],
  lz_k: [
    { key: 'Kmax', label: 'K max', step: 0.1, dflt: 2 },
    { key: 'alpha', label: 'α (frozen)', step: 0.01, dflt: Math.PI / 4 },
    { key: 'beta', label: 'β (frozen)', step: 0.01, dflt: Math.PI / 2 },
  ],
  shape_sphere: [
    { key: 'poleBuffer', label: 'Pole buffer ε', step: 0.01, dflt: 0.05 },
  ],
  mass_simplex: [
    { key: 'alpha', label: 'α (frozen)', step: 0.01, dflt: Math.PI / 4 },
    { key: 'beta', label: 'β (frozen)', step: 0.01, dflt: Math.PI / 2 },
  ],
  burrau_euclid: [
    { key: 'nu', label: 'ν', step: 0.01, dflt: 1 / 3 },
  ],
};

const AXIS_KIND_LABELS: Record<AxisSpec['kind'], string> = {
  latent: 'Latent z[k]', mass: 'Mass', lz: 'L_z', energy: 'Energy E',
  shape_alpha: 'Shape α', shape_beta: 'Shape β',
};

/** Sensible sweep range per kind, applied when the kind changes (a latent
 *  range like [-3,3] is meaningless for a mass component). */
const AXIS_KIND_RANGES: Record<AxisSpec['kind'], [number, number]> = {
  latent: [-3, 3], mass: [0.05, 0.95], lz: [-2, 2], energy: [-2, 2],
  shape_alpha: [0.1, Math.PI / 2 - 0.1], shape_beta: [0.1, Math.PI - 0.1],
};

export function mountChartParams(root: HTMLElement, app: App): () => void {
  const container = document.createElement('div');
  container.className = 'chart-params';
  root.appendChild(container);

  let builtFor = '';
  const off = app.store.subscribe((v) => {
    if (v.chartType === builtFor) return;
    builtFor = v.chartType;
    build(v.chartType);
  });

  function setParam(key: string, value: unknown): void {
    app.store.update((v) => ({
      ...v, chartParams: { ...v.chartParams, [key]: value },
    }));
  }

  function build(chartType: string): void {
    container.innerHTML = '';
    if (chartType === 'mixed_axis') { buildMixedAxis(); return; }
    const fields = CHART_FIELDS[chartType];
    if (!fields) return;
    for (const f of fields) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `
        <label for="cp_${f.key}">${f.label}</label>
        <input type="number" id="cp_${f.key}" step="${f.step}">`;
      const input = row.querySelector<HTMLInputElement>('input')!;
      const cur = app.store.snapshot().chartParams[f.key];
      input.value = String(typeof cur === 'number' ? cur : f.dflt);
      input.addEventListener('input', () => {
        const n = Number(input.value);
        if (Number.isFinite(n)) setParam(f.key, n);
      });
      container.appendChild(row);
    }
  }

  function buildMixedAxis(): void {
    const current = app.store.snapshot().chartParams;
    const axes = {
      hAxis: (current['hAxis'] as AxisSpec | undefined) ?? DEFAULT_AXES.hAxis,
      vAxis: (current['vAxis'] as AxisSpec | undefined) ?? DEFAULT_AXES.vAxis,
    };

    const editor = (slot: 'hAxis' | 'vAxis', title: string): HTMLElement => {
      const el = document.createElement('div');
      el.className = 'axis-editor';
      const a = axes[slot];
      el.innerHTML = `
        <div class="row"><label>${title}</label>
          <select data-f="kind">
            ${AXIS_KINDS.map((k) =>
              `<option value="${k}"${k === a.kind ? ' selected' : ''}>${AXIS_KIND_LABELS[k]}</option>`).join('')}
          </select>
        </div>
        <div class="row" data-row="index"><label>↳ lane k</label>
          <input type="number" data-f="index" min="0" max="7" step="1"
                 value="${a.kind === 'latent' ? a.index : 0}"></div>
        <div class="row" data-row="parameter"><label>↳ component</label>
          <select data-f="parameter">
            <option value="m1"${a.kind === 'mass' && a.parameter === 'm1' ? ' selected' : ''}>m1</option>
            <option value="m2"${a.kind === 'mass' && a.parameter === 'm2' ? ' selected' : ''}>m2</option>
          </select></div>
        <div class="row"><label>↳ range</label>
          <input type="number" data-f="lo" step="0.1" value="${a.range[0]}">
          <input type="number" data-f="hi" step="0.1" value="${a.range[1]}"></div>`;

      const q = <T extends HTMLElement>(sel: string): T => el.querySelector<T>(sel)!;
      const reflectRows = (): void => {
        const kind = q<HTMLSelectElement>('[data-f=kind]').value as AxisSpec['kind'];
        q<HTMLElement>('[data-row=index]').style.display = kind === 'latent' ? '' : 'none';
        q<HTMLElement>('[data-row=parameter]').style.display = kind === 'mass' ? '' : 'none';
      };
      reflectRows();

      let lastKind: AxisSpec['kind'] = a.kind;
      const commit = (): void => {
        const kind = q<HTMLSelectElement>('[data-f=kind]').value as AxisSpec['kind'];
        if (kind !== lastKind) {
          // A new kind means a new physical quantity: reset to its range.
          const [dl, dh] = AXIS_KIND_RANGES[kind];
          q<HTMLInputElement>('[data-f=lo]').value = String(dl);
          q<HTMLInputElement>('[data-f=hi]').value = String(dh);
          lastKind = kind;
        }
        const lo = Number(q<HTMLInputElement>('[data-f=lo]').value);
        const hi = Number(q<HTMLInputElement>('[data-f=hi]').value);
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return;
        const range: [number, number] = [lo, hi];
        let spec: AxisSpec;
        if (kind === 'latent') {
          const index = Math.min(7, Math.max(0,
            Math.round(Number(q<HTMLInputElement>('[data-f=index]').value) || 0)));
          spec = { kind, index, range };
        } else if (kind === 'mass') {
          spec = { kind, parameter: q<HTMLSelectElement>('[data-f=parameter]').value as 'm1' | 'm2', range };
        } else {
          spec = { kind, range } as AxisSpec;
        }
        axes[slot] = spec;
        reflectRows();
        const err = pairingError(axes.hAxis, axes.vAxis);
        const hint = container.querySelector<HTMLSpanElement>('#axisPairHint');
        if (hint) hint.textContent = err ? `⚠ ${err} — using defaults` : '';
        app.store.update((v) => ({
          ...v,
          chartParams: { ...v.chartParams, hAxis: axes.hAxis, vAxis: axes.vAxis },
        }));
      };
      el.addEventListener('change', commit);
      el.addEventListener('input', (e) => {
        if ((e.target as HTMLElement).matches('[data-f=lo],[data-f=hi],[data-f=index]')) commit();
      });
      return el;
    };

    container.appendChild(editor('hAxis', 'H axis'));
    container.appendChild(editor('vAxis', 'V axis'));
    const hint = document.createElement('div');
    hint.className = 'row';
    hint.innerHTML = '<span id="axisPairHint" class="hint"></span>';
    container.appendChild(hint);
  }

  return () => { off(); container.remove(); };
}
