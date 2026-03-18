/**
 * @fileoverview DOM Scrollbar Controller
 * Custom scrollbar implementation for elements with overflow
 * Used for: sidebar, stateBox textarea, and picker lists
 */

const INSET = 3; // px gap on all sides between thumb and track edge

/**
 * Initialize a custom DOM scrollbar for an element
 */
export function initScrollbar(
  scroller: HTMLElement,
  sb: HTMLElement,
  track: HTMLElement,
  thumb: HTMLElement,
  btnUp: HTMLElement,
  btnDown: HTMLElement,
  STEP: number
): void {
  function update(): void {
    const visible   = scroller.clientHeight;
    const total     = scroller.scrollHeight;
    const scrolled  = scroller.scrollTop;
    const trackH    = track.clientHeight;
    const available = trackH - INSET * 2;
    const thumbH    = Math.max(24, (visible / total) * available);
    const thumbTop  = total > visible
      ? INSET + (scrolled / (total - visible)) * (available - thumbH)
      : INSET;
    thumb.style.height = thumbH + 'px';
    thumb.style.top    = thumbTop + 'px';
    sb.style.display   = total > visible ? 'flex' : 'none';
  }

  // Update on scroll (immediate for smooth thumb movement)
  scroller.addEventListener('scroll', update, { passive: true });
  
  // Update on resize
  new ResizeObserver(update).observe(scroller);
  
  // Update on DOM changes (section open/close, content changes)
  new MutationObserver(() => requestAnimationFrame(update))
    .observe(scroller, { 
      childList: true, 
      subtree: true, 
      attributes: true, 
      attributeFilter: ['style', 'class'] 
    });

  // Arrow buttons - hold to repeat
  function makeArrow(dir: number): (e: MouseEvent) => void {
    let interval: number | null = null;
    function step(): void { scroller.scrollTop += dir * STEP; }
    function start(e: MouseEvent): void { 
      e.preventDefault(); 
      step(); 
      interval = window.setInterval(step, 120); 
      document.addEventListener('mouseup', () => {
        if (interval !== null) clearInterval(interval);
      }, { once: true }); 
    }
    return start;
  }
  btnUp.addEventListener('mousedown', makeArrow(-1));
  btnDown.addEventListener('mousedown', makeArrow(1));

  // Drag thumb
  thumb.addEventListener('mousedown', e => {
    e.preventDefault();
    const startY = e.clientY;
    const startScroll = scroller.scrollTop;
    const available = track.clientHeight - INSET * 2;
    const thumbH = Math.max(24, (scroller.clientHeight / scroller.scrollHeight) * available);
    const ratio = (scroller.scrollHeight - scroller.clientHeight) / (available - thumbH);
    
    function onMove(e: MouseEvent): void { 
      scroller.scrollTop = startScroll + (e.clientY - startY) * ratio; 
    }
    function onUp(): void { 
      document.removeEventListener('mousemove', onMove); 
      document.removeEventListener('mouseup', onUp); 
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Click track to jump
  track.addEventListener('mousedown', e => {
    if (e.target === thumb) return;
    const rect = track.getBoundingClientRect();
    const available = track.clientHeight - INSET * 2;
    const thumbH = Math.max(24, (scroller.clientHeight / scroller.scrollHeight) * available);
    const frac = Math.max(0, Math.min(1, (e.clientY - rect.top - INSET - thumbH / 2) / (available - thumbH)));
    scroller.scrollTop = frac * (scroller.scrollHeight - scroller.clientHeight);
  });

  // Initial update
  window.addEventListener('load', update);
  update();
}

/**
 * Initialize the main sidebar scrollbar with enhanced features
 * (Includes rAF-debounced updates for better performance)
 */
export function initSidebarScrollbar(): void {
  const scroller = document.getElementById('sidebar-scroll');
  const sb = document.getElementById('custom-sb');
  const track = document.getElementById('custom-sb-track');
  const thumb = document.getElementById('custom-sb-thumb');
  const btnUp = document.getElementById('custom-sb-up');
  const btnDown = document.getElementById('custom-sb-down');

  if (!scroller || !sb || !track || !thumb || !btnUp || !btnDown) {
    console.warn('[scrollbar] Missing sidebar scrollbar elements');
    return;
  }

  const STEP = 80;

  function update(): void {
    if (!scroller || !track || !thumb || !sb) return;

    const visible = scroller.clientHeight;
    const total = scroller.scrollHeight;
    const scrolled = scroller.scrollTop;
    const trackH = track.clientHeight;
    const available = trackH - INSET * 2;
    const thumbH = Math.max(24, (visible / total) * available);
    const thumbTop = total > visible
      ? INSET + (scrolled / (total - visible)) * (available - thumbH)
      : INSET;
    thumb.style.height = thumbH + 'px';
    thumb.style.top = thumbTop + 'px';
    sb.style.display = total > visible ? 'flex' : 'none';
  }

  // Scroll needs immediate update for smooth thumb
  scroller.addEventListener('scroll', update, { passive: true });

  // rAF-debounced update for layout changes
  let rafId: number | null = null;
  function scheduleUpdate(): void {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => { 
      rafId = null; 
      update(); 
    });
  }

  new ResizeObserver(scheduleUpdate).observe(scroller);
  new MutationObserver(scheduleUpdate).observe(scroller, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class']
  });

  window.addEventListener('load', scheduleUpdate);
  scheduleUpdate();

  // Arrow buttons
  function makeArrowScroll(dir: number): (e: MouseEvent) => void {
    let interval: number | null = null;
    function step(): void { scroller.scrollTop += dir * STEP; }
    function start(e: MouseEvent): void {
      e.preventDefault();
      step();
      interval = window.setInterval(step, 120);
      document.addEventListener('mouseup', stop, { once: true });
    }
    function stop(): void { 
      if (interval !== null) {
        clearInterval(interval); 
        interval = null;
      }
    }
    return start;
  }
  btnUp.addEventListener('mousedown', makeArrowScroll(-1));
  btnDown.addEventListener('mousedown', makeArrowScroll(1));

  // Drag thumb
  thumb.addEventListener('mousedown', e => {
    e.preventDefault();
    const startY = e.clientY;
    const startScroll = scroller.scrollTop;
    const trackH = track.clientHeight;
    const total = scroller.scrollHeight;
    const visible = scroller.clientHeight;
    const available = trackH - INSET * 2;
    const thumbH = Math.max(24, (visible / total) * available);
    const ratio = (total - visible) / (available - thumbH);
    
    function onMove(e: MouseEvent): void {
      scroller.scrollTop = startScroll + (e.clientY - startY) * ratio;
    }
    function onUp(): void {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Click track to jump
  track.addEventListener('mousedown', e => {
    if (e.target === thumb) return;
    const rect = track.getBoundingClientRect();
    const trackH = track.clientHeight;
    const total = scroller.scrollHeight;
    const visible = scroller.clientHeight;
    const available = trackH - INSET * 2;
    const thumbH = Math.max(24, (visible / total) * available);
    const frac = Math.max(0, Math.min(1,
      (e.clientY - rect.top - INSET - thumbH / 2) / (available - thumbH)));
    scroller.scrollTop = frac * (total - visible);
  });

  update();
}
