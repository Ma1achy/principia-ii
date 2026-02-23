import { $ } from '../utils.js';

// ─── Large resolution warning dialog ─────────────────────────────────────────

const _suppressedRes = new Set(JSON.parse(localStorage.getItem("principia_suppressedRes") || "[]"));

function saveSuppressed() {
  localStorage.setItem("principia_suppressedRes", JSON.stringify([..._suppressedRes]));
}

export function showLargeResWarning(resolution, onConfirm) {
  console.log(`[ResWarning] showLargeResWarning called with resolution=${resolution}`);
  
  if (_suppressedRes.has(resolution)) {
    console.log(`[ResWarning] Resolution ${resolution} is suppressed, calling onConfirm immediately`);
    onConfirm(resolution);
    return;
  }

  const warnOverlay = $("largeResOverlay");
  const warnMsg = $("largeResMsg");
  const warnConfirm = $("largeResConfirm");
  const warnCancel = $("largeResCancel");
  const warnAutoChk = $("largeResDisableAutoRender");
  const warnSuppressChk = $("largeResSuppressWarn");
  
  console.log(`[ResWarning] Dialog elements found:`, {
    overlay: !!warnOverlay,
    msg: !!warnMsg,
    confirm: !!warnConfirm,
    cancel: !!warnCancel,
    autoChk: !!warnAutoChk,
    suppressChk: !!warnSuppressChk
  });
  
  const tiled = resolution >= 8192;
  warnMsg.textContent = `${resolution} × ${resolution} is a ${tiled ? "tiled" : "large"} render (${tiled ? "≥8192 uses multi-pass tiling" : "high memory usage"}). This can be very slow, especially with auto-render enabled.`;
  warnAutoChk.checked = true;
  warnSuppressChk.checked = false;
  warnOverlay.classList.add("open");
  console.log(`[ResWarning] Dialog opened`);

  const escapeHandler = (e) => {
    if (e.key === "Escape" && warnOverlay.classList.contains("open")) {
      console.log(`[ResWarning] Escape pressed, closing dialog`);
      warnOverlay.classList.remove("open");
      document.removeEventListener("keydown", escapeHandler);
    }
  };

  const confirmHandler = () => {
    console.log(`[ResWarning] Confirm button clicked`);
    console.log(`[ResWarning] Auto-render checkbox: ${warnAutoChk.checked}`);
    console.log(`[ResWarning] Suppress checkbox: ${warnSuppressChk.checked}`);
    
    if (warnAutoChk.checked) {
      console.log(`[ResWarning] Disabling auto-render`);
      $("autoRender").checked = false;
    }
    if (warnSuppressChk.checked) {
      console.log(`[ResWarning] Adding ${resolution} to suppressed list`);
      _suppressedRes.add(resolution);
      saveSuppressed();
    }
    
    console.log(`[ResWarning] Closing dialog and calling onConfirm(${resolution})`);
    warnOverlay.classList.remove("open");
    document.removeEventListener("keydown", escapeHandler);
    onConfirm(resolution);
    console.log(`[ResWarning] onConfirm called`);
  };

  const cancelHandler = () => {
    console.log(`[ResWarning] Cancel button clicked`);
    warnOverlay.classList.remove("open");
    document.removeEventListener("keydown", escapeHandler);
  };

  console.log(`[ResWarning] Adding event listeners`);
  // Use { once: true } only for click events, not for keydown
  warnConfirm.addEventListener("click", confirmHandler, { once: true });
  warnCancel.addEventListener("click", cancelHandler, { once: true });
  document.addEventListener("keydown", escapeHandler);
  console.log(`[ResWarning] Event listeners added`);
}
