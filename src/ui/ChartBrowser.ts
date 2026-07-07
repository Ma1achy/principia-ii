import type { App } from '@/app/app.js';
import { type PresetStore, applyPreset, savePreset, type Preset } from './presets.js';

export interface ChartBrowserHandle {
  open: () => void;
  close: () => void;
  dispose: () => void;
}

/**
 * The preset gallery: renders PresetStore.all() as a clickable grid,
 * applies a preset via applyPreset + store.setView (one compute-affecting
 * change → one history entry), and saves the live view as a user preset.
 */
export function mountChartBrowser(
  root: HTMLElement, app: App, initial: PresetStore,
): ChartBrowserHandle {
  let store = initial;
  root.innerHTML = `
    <div class="gallery" hidden>
      <h3>Presets</h3>
      <div class="gallery-grid"></div>
      <div class="row">
        <input id="presetName" type="text" placeholder="New preset name">
        <button id="savePreset">Save current view</button>
      </div>
    </div>
  `;
  const panel = root.querySelector<HTMLDivElement>('.gallery')!;
  const grid = root.querySelector<HTMLDivElement>('.gallery-grid')!;

  const apply = (p: Preset): void => {
    app.store.setView(applyPreset(app.store.snapshot(), p));   // → history push
  };

  const render = (): void => {
    grid.innerHTML = '';
    for (const p of store.all()) {
      const card = document.createElement('button');
      card.className = 'preset-card' + (p.builtin ? ' builtin' : '');
      card.textContent = p.name;
      card.addEventListener('click', () => apply(p));
      grid.appendChild(card);
    }
  };

  root.querySelector<HTMLButtonElement>('#savePreset')!.addEventListener('click', () => {
    const name = root.querySelector<HTMLInputElement>('#presetName')!.value.trim();
    if (!name) return;
    const id = `user_${Date.now()}`;
    store = store.save(savePreset(id, name, app.store.snapshot()));
    render();
  });

  render();
  return {
    open:  () => { panel.hidden = false; },
    close: () => { panel.hidden = true; },
    dispose: () => { root.innerHTML = ''; },
  };
}
