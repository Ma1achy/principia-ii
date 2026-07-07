import type { App } from '@/app/app.js';
import { bind } from './reactive.js';

export function mountInspectorPanel(root: HTMLElement, app: App): () => void {
  root.innerHTML = `
    <div class="inspector" hidden>
      <h3>Locked pixel</h3>
      <div class="ic-summary">
        <div>Masses: <span class="masses"></span></div>
        <div>Outcome: <span class="outcome"></span></div>
        <div>t<sub>end</sub>: <span class="tEnd"></span></div>
        <div>Δ<i>E</i><sub>max</sub>: <span class="deltaE"></span></div>
        <div>Word: <code class="word"></code></div>
      </div>
      <button class="unlock" type="button">Unlock</button>
    </div>
  `;
  const panel = root.querySelector<HTMLDivElement>('.inspector');
  if (!panel) throw new Error('InspectorPanel: mount failed');
  panel.querySelector<HTMLButtonElement>('.unlock')
    ?.addEventListener('click', () => app.input.unlock());

  let generation = 0;
  return bind(panel, app.store, (el, v) => {
    el.hidden = !v.locked;
    el.querySelector('.masses')!.textContent =
      v.lockedPhysical?.m.map((x) => x.toFixed(3)).join(', ') ?? '—';
    if (!v.locked) return;
    const gen = ++generation;
    void app.inspector()?.then((insp) => {
      if (gen !== generation) return;      // a newer lock superseded this one
      el.querySelector('.outcome')!.textContent = insp.outcome ?? '—';
      el.querySelector('.tEnd')!.textContent =
        insp.tEnd !== undefined ? insp.tEnd.toFixed(3) : '—';
      el.querySelector('.deltaE')!.textContent =
        insp.deltaEMax !== undefined ? insp.deltaEMax.toExponential(2) : '—';
      el.querySelector('.word')!.textContent = insp.freeGroupWord || '∅';
    });
  });
}
