import { GlassPanel } from './GlassPanel.js';

// ─── GlTooltip ───────────────────────────────────────────────────────────────
// Floating fixed-position tooltip using the glass effect.
// Styles: src/ui/components/glass/glass-tooltip.css

export class GlTooltip {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'glass-tooltip-canvas';
    document.body.appendChild(this.canvas);
    this._panel = null;
    this._initPromise = GlassPanel.create(this.canvas).then(p => { this._panel = p; });
  }

  _cropElement(el, screenX, screenY, W, H) {
    const r = el.getBoundingClientRect();
    const scaleX = el.width  / r.width;
    const scaleY = el.height / r.height;
    const sx = (screenX - r.left) * scaleX;
    const sy = (screenY - r.top)  * scaleY;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').drawImage(el, sx, sy, W * scaleX, H * scaleY, 0, 0, W, H);
    return c;
  }

  _buildTextCanvas(lines, W, H, dpr) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'white';
    ctx.textBaseline = 'top';
    const FONT_SIZE = 10 * dpr;
    const LINE_H    = 13 * dpr;
    const PAD_X     = 10 * dpr;
    const PAD_Y     = 7  * dpr;
    let y = PAD_Y;
    for (const ln of lines) {
      ctx.globalAlpha = 1.0;
      if (ln.type === 'hint') {
        ctx.font = `${FONT_SIZE}px "IBM Plex Mono", monospace`;
        const words = ln.text.split(' ');
        const maxW = W - PAD_X * 2;
        let line = '';
        for (const word of words) {
          const test = line ? line + ' ' + word : word;
          if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, PAD_X, y);
            y += LINE_H;
            line = word;
          } else {
            line = test;
          }
        }
        if (line) { ctx.fillText(line, PAD_X, y); y += LINE_H; }
      } else {
        ctx.font = `${FONT_SIZE}px "IBM Plex Mono", monospace`;
        ctx.fillText(ln.label, PAD_X, y);
        const vw = ctx.measureText(ln.val).width;
        ctx.fillText(ln.val, W - PAD_X - vw, y);
        y += LINE_H;
      }
    }
    return c;
  }

  render(lines, screenX, screenY, W, H, sceneEl) {
    this.canvas.style.left   = screenX + 'px';
    this.canvas.style.top    = screenY + 'px';
    this.canvas.style.width  = W + 'px';
    this.canvas.style.height = H + 'px';
    this.canvas.width  = W;
    this.canvas.height = H;
    this.canvas.classList.add('visible');

    const cs   = getComputedStyle(this.canvas);
    const glass = parseFloat(cs.getPropertyValue('--glass').trim() || '1');
    const blur  = parseFloat(cs.getPropertyValue('--glass-blur').trim() || '1.0');

    const dpr = window.devicePixelRatio || 1;

    let sceneC;
    if (glass && sceneEl) {
      sceneC = this._cropElement(sceneEl, screenX, screenY, W, H);
    } else {
      sceneC = document.createElement('canvas');
      sceneC.width = W; sceneC.height = H;
      const ctx = sceneC.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#efede8';
      ctx.fillRect(0, 0, W, H);
    }

    const textC_hi = this._buildTextCanvas(lines, W * dpr, H * dpr, dpr);
    const textScaled = document.createElement('canvas');
    textScaled.width = W; textScaled.height = H;
    textScaled.getContext('2d').drawImage(textC_hi, 0, 0, W, H);

    GlassPanel.create(this.canvas).then(panel => panel.draw(sceneC, textScaled, blur));
  }

  hide() {
    this.canvas.classList.remove('visible');
  }
}
