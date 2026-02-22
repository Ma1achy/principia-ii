import { $ } from '../utils.js';

// ─── Large resolution warning dialog ─────────────────────────────────────────

const _suppressedRes = new Set(JSON.parse(localStorage.getItem("principia_suppressedRes") || "[]"));

function saveSuppressed() {
  localStorage.setItem("principia_suppressedRes", JSON.stringify([..._suppressedRes]));
}

export function showLargeResWarning(resolution, onConfirm) {
  if (_suppressedRes.has(resolution)) {
    onConfirm(resolution);
    return;
  }

  const warnOverlay = $("largeResOverlay");
  const warnMsg = $("largeResMsg");
  const warnConfirm = $("largeResConfirm");
  const warnCancel = $("largeResCancel");
  const warnAutoChk = $("largeResDisableAutoRender");
  const warnSuppressChk = $("largeResSuppressWarn");
  
  let _pendingLargeRes = resolution;
  const tiled = resolution >= 8192;
  warnMsg.textContent = `${resolution} × ${resolution} is a ${tiled ? "tiled" : "large"} render (${tiled ? "≥8192 uses multi-pass tiling" : "high memory usage"}). This can be very slow, especially with auto-render enabled.`;
  warnAutoChk.checked = true;
  warnSuppressChk.checked = false;
  warnOverlay.classList.add("open");

  const confirmHandler = () => {
    if (warnAutoChk.checked) $("autoRender").checked = false;
    if (warnSuppressChk.checked && _pendingLargeRes !== null) {
      _suppressedRes.add(_pendingLargeRes);
      saveSuppressed();
    }
    warnOverlay.classList.remove("open");
    if (_pendingLargeRes !== null) {
      onConfirm(_pendingLargeRes);
      _pendingLargeRes = null;
    }
    cleanup();
  };

  const cancelHandler = () => {
    warnOverlay.classList.remove("open");
    _pendingLargeRes = null;
    cleanup();
  };

  const escapeHandler = (e) => {
    if (e.key === "Escape" && warnOverlay.classList.contains("open")) {
      warnOverlay.classList.remove("open");
      _pendingLargeRes = null;
      cleanup();
    }
  };

  const cleanup = () => {
    warnConfirm.removeEventListener("click", confirmHandler);
    warnCancel.removeEventListener("click", cancelHandler);
    document.removeEventListener("keydown", escapeHandler);
  };

  warnConfirm.addEventListener("click", confirmHandler);
  warnCancel.addEventListener("click", cancelHandler);
  document.addEventListener("keydown", escapeHandler);
}
