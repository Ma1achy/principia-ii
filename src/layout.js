/**
 * computeTitleBoundingBox - Calculate available space for title block
 * 
 * Uses raycasting to detect obstacles (canvas, axes, controls) and
 * returns safe bounding box constraints.
 * 
 * Pure layout calculation - no DOM mutation.
 * 
 * @returns {Object} - { maxFontSize, availableWidth, availableHeight, x, y }
 */
export function computeTitleBoundingBox() {
  const TITLE_LEFT_PX = 20;
  const TITLE_TOP_PX = 20;
  const MARGIN_PX = 14;
  const MAX_CAP_PX = 260;
  
  const SUB_RATIO = 0.135;
  const TITLE_LINEH = 0.90;
  const SUB_LINEH = 1.00;
  const GAP_EM = 0.18;
  
  // Get obstacle elements
  const glCanvas = document.getElementById("glCanvas");
  const outCanvas = document.getElementById("outCanvas");
  const axisLeft = document.getElementById("axis-left");
  const axisBot = document.getElementById("axis-bottom");
  const hudEl = document.getElementById("hud-panel");
  const legendEl = document.getElementById("legend-panel");
  const sidebar = document.getElementById("sidebar");
  
  const plotEl = (outCanvas && outCanvas.style.display !== "none") ? outCanvas : glCanvas;
  
  console.log('[Layout] Canvas detection:', {
    glCanvas: glCanvas ? `${glCanvas.getBoundingClientRect().width}x${glCanvas.getBoundingClientRect().height} at (${glCanvas.getBoundingClientRect().left}, ${glCanvas.getBoundingClientRect().top})` : 'null',
    outCanvas: outCanvas ? `${outCanvas.getBoundingClientRect().width}x${outCanvas.getBoundingClientRect().height}` : 'null',
    plotEl: plotEl ? (() => { const r = plotEl.getBoundingClientRect(); return `${r.width}x${r.height} at (${r.left}, ${r.top})`; })() : 'null',
    windowSize: `${window.innerWidth}x${window.innerHeight}`
  });
  
  if (!plotEl) {
    console.warn('[Layout] No canvas found, using fallback');
    return {
      maxFontSize: 40,
      availableWidth: 400,
      availableHeight: 100,
      x: TITLE_LEFT_PX,
      y: TITLE_TOP_PX
    };
  }
  
  const plotRect = plotEl.getBoundingClientRect();
  if (plotRect.width <= 0 || plotRect.height <= 0) {
    console.warn('[Layout] Canvas has no size, using fallback');
    return {
      maxFontSize: 40,
      availableWidth: 400,
      availableHeight: 100,
      x: TITLE_LEFT_PX,
      y: TITLE_TOP_PX
    };
  }
  
  // Build obstacle rects
  function rectOf(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  
  function inflateRect(r, pad) {
    return { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad };
  }
  
  let sidebarPad = 12;
  if (sidebar && plotEl) {
    const sidebarRect = sidebar.getBoundingClientRect();
    const canvasRect = plotEl.getBoundingClientRect();
    const gap = sidebarRect.left - canvasRect.right;
    if (gap > 0) sidebarPad = gap;
  }
  
  const SIDEBAR_PAD = sidebarPad;
  const CANVAS_PAD = 8;
  const AXIS_PAD = 0;  // No padding for axes - title can get close
  
  const obstacles = [
    rectOf(plotEl) ? inflateRect(rectOf(plotEl), CANVAS_PAD) : null,
    rectOf(sidebar) ? inflateRect(rectOf(sidebar), SIDEBAR_PAD) : null,
    rectOf(axisLeft) ? inflateRect(rectOf(axisLeft), AXIS_PAD) : null,
    rectOf(axisBot) ? inflateRect(rectOf(axisBot), AXIS_PAD) : null,
    rectOf(hudEl),
    rectOf(legendEl),
  ].filter(Boolean);
  
  // Ray vs AABB intersection
  function rayHitAABB(ox, oy, dx, dy, r) {
    const invDx = dx !== 0 ? 1 / dx : Infinity;
    const invDy = dy !== 0 ? 1 / dy : Infinity;
    
    let t1 = (r.left - ox) * invDx;
    let t2 = (r.right - ox) * invDx;
    let t3 = (r.top - oy) * invDy;
    let t4 = (r.bottom - oy) * invDy;
    
    let tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
    let tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
    
    if (tmax < 0) return null;
    if (tmin > tmax) return null;
    const t = tmin >= 0 ? tmin : tmax;
    if (t < 0) return null;
    
    return { t, x: ox + t * dx, y: oy + t * dy };
  }
  
  // Cast diagonal ray
  function diagonalBounds(ox, oy) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    const toCornerX = vw - ox;
    const toCornerY = vh - oy;
    const len = Math.hypot(toCornerX, toCornerY);
    const dx = toCornerX / len;
    const dy = toCornerY / len;
    
    let best = { t: len, x: vw, y: vh };
    
    for (const r of obstacles) {
      const hit = rayHitAABB(ox, oy, dx, dy, r);
      if (hit && hit.t < best.t) {
        best = hit;
      }
    }
    
    best.x = Math.max(ox, Math.min(vw, best.x));
    best.y = Math.max(oy, Math.min(vh, best.y));
    return best;
  }
  
  const anchorX = TITLE_LEFT_PX;
  const anchorY = TITLE_TOP_PX;
  
  const diagonalHit = diagonalBounds(anchorX, anchorY);
  
  console.log('[Layout] Diagonal raycast hit:', { 
    from: { x: anchorX, y: anchorY },
    to: diagonalHit,
    distance: Math.hypot(diagonalHit.x - anchorX, diagonalHit.y - anchorY)
  });
  
  const vw = window.innerWidth;
  let maxX = vw;
  
  const EDGE_EPSILON = 0.5;
  for (const r of obstacles) {
    if (Math.abs(r.top - diagonalHit.y) < EDGE_EPSILON || 
        Math.abs(r.bottom - diagonalHit.y) < EDGE_EPSILON) {
      continue;
    }
    const hit = rayHitAABB(anchorX, diagonalHit.y, 1, 0, r);
    if (hit && hit.x < maxX) maxX = hit.x;
  }
  
  const maxW = Math.max(1, (maxX - anchorX - MARGIN_PX));
  const maxH = Math.max(1, (diagonalHit.y - anchorY - MARGIN_PX));
  
  console.log('[Layout] Available space:', { maxW, maxH, diagonalHit });
  
  // Instead of guessing, measure the actual rendered title to find max font size
  // Create a temporary element to measure
  const tempWrapper = document.createElement('div');
  tempWrapper.style.cssText = 'position: fixed; left: -9999px; top: -9999px; visibility: hidden;';
  
  const tempTitle = document.createElement('div');
  tempTitle.textContent = 'Principia';
  tempTitle.style.cssText = 'font-family: Geist, system-ui, sans-serif; font-weight: 900; line-height: 0.90; white-space: nowrap;';
  
  const tempSubtitle = document.createElement('div');
  tempSubtitle.textContent = 'SAMPLE TEXT FOR SIZING';
  tempSubtitle.style.cssText = 'font-family: "IBM Plex Mono", monospace; font-weight: 500; text-transform: uppercase; line-height: 1.00; white-space: nowrap;';
  
  tempWrapper.appendChild(tempTitle);
  tempWrapper.appendChild(tempSubtitle);
  document.body.appendChild(tempWrapper);
  
  // Binary search for maximum font size that fits
  let minSize = 10;
  let maxSize = MAX_CAP_PX;
  let bestSize = minSize;
  
  for (let i = 0; i < 20; i++) {  // 20 iterations is plenty
    const testSize = Math.floor((minSize + maxSize) / 2);
    
    tempTitle.style.fontSize = `${testSize}px`;
    tempSubtitle.style.fontSize = `${testSize * SUB_RATIO}px`;
    
    const gapPx = Math.round(testSize * GAP_EM);
    tempSubtitle.style.marginTop = `${gapPx}px`;
    
    const titleRect = tempTitle.getBoundingClientRect();
    const subtitleRect = tempSubtitle.getBoundingClientRect();
    
    const blockW = titleRect.width;
    const blockH = titleRect.height + gapPx + subtitleRect.height;
    
    if (blockW <= maxW && blockH <= maxH) {
      bestSize = testSize;
      minSize = testSize + 1;  // Try larger
    } else {
      maxSize = testSize - 1;  // Too big, try smaller
    }
  }
  
  document.body.removeChild(tempWrapper);
  
  const maxFontSize = bestSize;
  
  console.log('[Layout] Font size found via measurement:', { 
    maxFontSize,
    availableSpace: { maxW, maxH }
  });
  
  return {
    maxFontSize,
    availableWidth: maxW,
    availableHeight: maxH,
    x: anchorX,
    y: anchorY
  };
}
