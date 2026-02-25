/**
 * @fileoverview DOM Scrollbar Controller
 * Custom scrollbar implementation for elements with overflow
 * Used for: sidebar, stateBox textarea, and picker lists
 */

const INSET = 3; // px gap on all sides between thumb and track edge

/**
 * Initialize a custom DOM scrollbar for an element
 * @param {HTMLElement} scroller - The scrollable element
 * @param {HTMLElement} sb - The scrollbar container
 * @param {HTMLElement} track - The scrollbar track
 * @param {HTMLElement} thumb - The scrollbar thumb
 * @param {HTMLElement} btnUp - Up arrow button
 * @param {HTMLElement} btnDown - Down arrow button
 * @param {number} STEP - Scroll distance per arrow click (px)
 */
export function initScrollbar(scroller, sb, track, thumb, btnUp, btnDown, STEP) {
  function update() {
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
  function makeArrow(dir) {
    let interval = null;
    function step() { scroller.scrollTop += dir * STEP; }
    function start(e) { 
      e.preventDefault(); 
      step(); 
      interval = setInterval(step, 120); 
      document.addEventListener('mouseup', () => clearInterval(interval), { once: true }); 
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
    
    function onMove(e) { 
      scroller.scrollTop = startScroll + (e.clientY - startY) * ratio; 
    }
    function onUp() { 
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
export function initSidebarScrollbar() {
  const scroller = document.getElementById('sidebar-scroll');
  const sb = document.getElementById('custom-sb');
  const track = document.getElementById('custom-sb-track');
  const thumb = document.getElementById('custom-sb-thumb');
  const btnUp = document.getElementById('custom-sb-up');
  const btnDown = document.getElementById('custom-sb-down');
  const STEP = 80;

  function update() {
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
  let rafId = null;
  function scheduleUpdate() {
    if (rafId) return;
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
  function makeArrowScroll(dir) {
    let interval = null;
    function step() { scroller.scrollTop += dir * STEP; }
    function start(e) {
      e.preventDefault();
      step();
      interval = setInterval(step, 120);
      document.addEventListener('mouseup', stop, { once: true });
    }
    function stop() { 
      clearInterval(interval); 
      interval = null; 
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
    
    function onMove(e) {
      scroller.scrollTop = startScroll + (e.clientY - startY) * ratio;
    }
    function onUp() {
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
