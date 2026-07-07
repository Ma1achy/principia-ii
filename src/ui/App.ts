import type { App as AppCore } from '@/app/app.js';
import { mountControlPanel } from './ControlPanel.js';
import { mountCanvas } from './Canvas.js';
import { mountInspectorPanel } from './InspectorPanel.js';

export function mountUI(
  root: HTMLElement, app: AppCore, canvas: HTMLCanvasElement,
): () => void {
  root.innerHTML = `
    <div class="layout">
      <div class="canvas-area"></div>
      <div class="side">
        <div class="control-area"></div>
        <div class="inspector-area"></div>
      </div>
    </div>
  `;
  const area = (sel: string): HTMLElement => {
    const el = root.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(`mountUI: missing ${sel}`);
    return el;
  };
  const offs = [
    mountCanvas(area('.canvas-area'), app, canvas),
    mountControlPanel(area('.control-area'), app),
    mountInspectorPanel(area('.inspector-area'), app),
  ];
  return () => offs.forEach((off) => off());
}
