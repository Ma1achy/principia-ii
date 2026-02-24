import { showDialog } from './dialog.js';

// ─── Value-edit dialog ────────────────────────────────────────────────────────

export function bindValEditDialog() {
  // Listen for double-clicks on slider values
  document.addEventListener("dblclick", async (e) => {
    const ni = e.target.closest(".slider-num");
    if (!ni) return;
    
    const title = ni.dataset.title || "Value";
    const desc  = ni.dataset.tip   || "";
    const min   = +ni.min;
    const max   = +ni.max;
    const step  = +ni.step;
    const cur   = +ni.value;
    const unit  = ni.closest(".sl-val-wrap")?.querySelector(".sl-unit")?.textContent || "";
    const fullTitle = unit ? `${title} (${unit.trim()})` : title;
    
    console.log(`[ValueEdit] Opening dialog for ${fullTitle}`);
    
    try {
      const result = await showDialog({
        id: 'value-edit',
        title: fullTitle,
        content: desc ? { text: desc } : undefined,
        fields: [
          {
            id: 'value',
            type: 'number',
            value: String(cur),
            min,
            max,
            step,
            selectOnFocus: true,
            autoFocus: true
          }
        ],
        buttons: [
          {
            id: 'cancel',
            label: 'Cancel',
            role: 'secondary',
            intent: 'cancel',
            hotkey: 'Escape'
          },
          {
            id: 'set',
            label: 'Set',
            role: 'primary',
            intent: 'confirm',
            hotkey: 'Enter'
          }
        ],
        closeOnEscape: true,
        closeOnBackdrop: true,
        beforeClose: (attempt) => {
          // Validate numeric input
          if (attempt.action === 'set') {
            const val = parseFloat(attempt.values.value);
            if (isNaN(val)) {
              alert('Please enter a valid number');
              return false;
            }
            if (val < min || val > max) {
              alert(`Value must be between ${min} and ${max}`);
              return false;
            }
          }
          return true;
        }
      });
      
      console.log(`[ValueEdit] Dialog closed:`, result);
      
      // Update value if confirmed
      if (result.confirmed) {
        const val = parseFloat(result.values.value);
        const clamped = Math.max(min, Math.min(max, val));
        const decimals = step < 0.001 ? 4 : step < 0.01 ? 3 : 2;
        ni.value = clamped.toFixed(decimals);
        ni.dispatchEvent(new Event("change", { bubbles: true }));
        console.log(`[ValueEdit] Value updated to ${ni.value}`);
      }
    } catch (err) {
      console.error('[ValueEdit] Error:', err);
    }
  });
}
