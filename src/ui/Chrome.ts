import type { ErrorBoundary } from '@/error/boundary.js';
import type { AppError } from '@/error/kinds.js';
import type { CapabilityProfile } from '@/gpu/capability.js';

/**
 * Shell chrome: G9 capability warnings (rendered once) + the G11 error
 * overlay (stack-free userMessage; recoverable errors auto-dismiss, fatal
 * ones pin). Registers as a SECONDARY boundary listener so the boundary —
 * constructed before the DOM, around GPU init — needs no rewiring.
 */
export function mountChrome(
  root: HTMLElement, boundary: ErrorBoundary | undefined,
  capability: CapabilityProfile | undefined,
): () => void {
  root.innerHTML = `
    <div class="warnings"></div>
    <div class="error-overlay" hidden role="alert"><span class="error-text"></span></div>
  `;
  const warnings = root.querySelector<HTMLDivElement>('.warnings')!;
  const overlay = root.querySelector<HTMLDivElement>('.error-overlay')!;
  const errText = root.querySelector<HTMLSpanElement>('.error-text')!;

  // G9: capability warnings (and an unsupported banner) rendered once.
  // textContent, not innerHTML — warning strings must never inject markup.
  if (capability) {
    if (!capability.supported && capability.reason) {
      const b = document.createElement('div');
      b.className = 'banner banner-error';
      b.textContent = `WebGPU unavailable (${capability.reason}).`;
      warnings.appendChild(b);
    } else {
      for (const w of capability.warnings) {
        const b = document.createElement('div');
        b.className = 'banner banner-warn';
        b.textContent = w;
        warnings.appendChild(b);
      }
    }
  }

  // G11: route user-facing errors into the overlay (never a raw stack).
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  const off = boundary?.addUserErrorListener((app: AppError, message: string) => {
    errText.textContent = message;
    overlay.hidden = false;
    if (dismissTimer !== undefined) clearTimeout(dismissTimer);
    if (app.recoverable) {
      dismissTimer = setTimeout(() => { overlay.hidden = true; }, 5000);
    }
  });

  return () => {
    if (dismissTimer !== undefined) clearTimeout(dismissTimer);
    off?.();
    root.innerHTML = '';
  };
}
