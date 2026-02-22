import { state, AXIS_NAMES } from '../../state.js';
import { decodeICParamsFromZ } from '../../math.js';
import { $ } from '../utils.js';

// ─── Probe ───────────────────────────────────────────────────────────────────

export function uvFromClientXY(clientX, clientY, glCanvas, outCanvas) {
  const rect = (outCanvas.style.display !== "none" ? outCanvas : glCanvas).getBoundingClientRect();
  return {
    u: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    v: Math.max(0, Math.min(1, 1.0 - (clientY - rect.top) / rect.height)),
    rect
  };
}

export function zAtUV(u, v, renderer) {
  const view = renderer.fullViewTile(state);
  const uw = view.offX + u * view.scX;
  const vw = view.offY + v * view.scY;
  const uu = 2 * uw - 1, vv = 2 * vw - 1;
  const { q1, q2 } = renderer.computeSliceDirs(state);
  return state.z0.map((z0i, i) => z0i + uu * q1[i] + vv * q2[i]);
}

export function showProbeAtEvent(e, probeTooltip, glCanvas, outCanvas, renderer, interactionState) {
  if (!$("showHud").checked) {
    if (interactionState) {
      interactionState.probeActive = false;
    }
    return;
  }
  
  const { u, v, rect } = uvFromClientXY(e.clientX, e.clientY, glCanvas, outCanvas);
  const z = zAtUV(u, v, renderer);
  const p = decodeICParamsFromZ(z);
  const topZ = z.map((val, i) => ({ i, val, a: Math.abs(val) })).sort((a, b) => b.a - a.a).slice(0, 4);
  const view = renderer.fullViewTile(state);
  const wx = view.offX + u * view.scX;
  const wy = view.offY + v * view.scY;
  
  // Throttle pixel sampling - only every ~200ms to reduce lag
  const now = Date.now();
  if (!showProbeAtEvent.lastSampleTime || now - showProbeAtEvent.lastSampleTime > 200) {
    showProbeAtEvent.lastSampleTime = now;
    
    if (interactionState) {
      const activeCanvas = outCanvas.style.display !== "none" ? outCanvas : glCanvas;
      const pixelX = Math.floor((e.clientX - rect.left) * (activeCanvas.width / rect.width));
      const pixelY = Math.floor((e.clientY - rect.top) * (activeCanvas.height / rect.height));
      
      try {
        const gl = activeCanvas.getContext('webgl2') || activeCanvas.getContext('webgl');
        if (gl) {
          const pixel = new Uint8Array(4);
          const glY = activeCanvas.height - pixelY - 1;
          gl.readPixels(pixelX, glY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          
          if (state.mode === 0) {
            const r = pixel[0] / 255;
            const g = pixel[1] / 255;
            const b = pixel[2] / 255;
            
            const isRed = r > 0.1 && g < 0.1 && b < 0.1;
            const isGreen = g > 0.1 && r < 0.1 && b < 0.1;
            const isBlue = b > 0.1 && r < 0.1 && g < 0.1;
            const hasCollision = isRed || isGreen || isBlue;
            
            const isYellow = r > 0.7 && g > 0.7 && b < 0.1;
            const isMagenta = r > 0.7 && b > 0.7 && g < 0.1;
            const isCyan = g > 0.7 && b > 0.7 && r < 0.1;
            const hasEscape = isYellow || isMagenta || isCyan;
            
            interactionState.probeActive = true;
            interactionState.hasCollision = hasCollision;
            interactionState.hasEscape = hasEscape;
            interactionState.stabilityValue = 0;
          } 
          else if (state.mode === 1) {
            const intensity = (pixel[0] + pixel[1] + pixel[2]) / (3 * 255);
            interactionState.probeActive = true;
            interactionState.hasCollision = false;
            interactionState.hasEscape = false;
            interactionState.stabilityValue = intensity;
          } else {
            interactionState.probeActive = true;
            interactionState.hasCollision = false;
            interactionState.hasEscape = false;
            interactionState.stabilityValue = 0;
          }
        } else {
          interactionState.probeActive = false;
        }
      } catch (err) {
        console.warn('Failed to read pixel data:', err);
        interactionState.probeActive = false;
      }
    }
  }
  
  const lines = [
    { type: "row", label: "world", val: `(${wx.toFixed(5)}, ${wy.toFixed(5)})` },
    { type: "row", label: "m",     val: `[${p.m.map(x => x.toFixed(5)).join(", ")}]` },
    { type: "row", label: "α, β",  val: `${p.alpha.toFixed(5)}, ${p.beta.toFixed(5)}` },
    { type: "row", label: "pρ",    val: `[${p.pRho.map(x => x.toFixed(5)).join(", ")}]` },
    { type: "row", label: "pλ",    val: `[${p.pLam.map(x => x.toFixed(5)).join(", ")}]` },
    ...topZ.map(t => ({ type: "row", label: AXIS_NAMES[t.i], val: t.val.toFixed(5) }))
  ];
  const rowCount = lines.length;
  const PW = 230, PH = rowCount * 13 + 18;
  const vw = window.innerWidth, vh = window.innerHeight;
  let sx = e.clientX + 14, sy = e.clientY + 14;
  if (sx + PW > vw - 8) sx = e.clientX - PW - 8;
  if (sy + PH > vh - 8) sy = e.clientY - PH - 8;
  const activeCanvas = outCanvas.style.display !== "none" ? outCanvas : glCanvas;
  probeTooltip.render(lines, sx, sy, PW, PH, activeCanvas);
}
