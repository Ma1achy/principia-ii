const SETTINGS_KEY = 'principia_settings';

/**
 * Application settings
 */
export interface Settings {
  autoRender: boolean;
  previewWhileDrag: boolean;
  showHud: boolean;
  invertScroll: boolean;
  zoomSpeed: number;
  invertPanX: boolean;
  invertPanY: boolean;
  panSpeed: number;
  suppressWelcomeDialog: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  autoRender: true,
  previewWhileDrag: true,
  showHud: true,
  invertScroll: false,
  zoomSpeed: 1.0,
  invertPanX: false,
  invertPanY: false,
  panSpeed: 1.0,
  suppressWelcomeDialog: false
};

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  } catch (e) {
    console.error('[Settings] Failed to load:', e);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('[Settings] Failed to save:', e);
  }
}

export function applySavedSettings(): Settings {
  const settings = loadSettings();
  
  const autoRenderEl = document.getElementById('autoRender') as HTMLInputElement | null;
  const previewWhileDragEl = document.getElementById('previewWhileDrag') as HTMLInputElement | null;
  const showHudEl = document.getElementById('showHud') as HTMLInputElement | null;
  const stgInvertScrollEl = document.getElementById('stgInvertScroll') as HTMLInputElement | null;
  const stgZoomSpeedEl = document.getElementById('stgZoomSpeed') as HTMLInputElement | null;
  const stgZoomSpeedValEl = document.getElementById('stgZoomSpeedVal') as HTMLInputElement | null;
  const stgInvertPanXEl = document.getElementById('stgInvertPanX') as HTMLInputElement | null;
  const stgInvertPanYEl = document.getElementById('stgInvertPanY') as HTMLInputElement | null;
  const stgPanSpeedEl = document.getElementById('stgPanSpeed') as HTMLInputElement | null;
  const stgPanSpeedValEl = document.getElementById('stgPanSpeedVal') as HTMLInputElement | null;
  
  if (autoRenderEl) autoRenderEl.checked = settings.autoRender;
  if (previewWhileDragEl) previewWhileDragEl.checked = settings.previewWhileDrag;
  if (showHudEl) showHudEl.checked = settings.showHud;
  if (stgInvertScrollEl) stgInvertScrollEl.checked = settings.invertScroll;
  if (stgZoomSpeedEl) stgZoomSpeedEl.value = String(settings.zoomSpeed);
  if (stgZoomSpeedValEl) stgZoomSpeedValEl.value = String(settings.zoomSpeed);
  if (stgInvertPanXEl) stgInvertPanXEl.checked = settings.invertPanX;
  if (stgInvertPanYEl) stgInvertPanYEl.checked = settings.invertPanY;
  if (stgPanSpeedEl) stgPanSpeedEl.value = String(settings.panSpeed);
  if (stgPanSpeedValEl) stgPanSpeedValEl.value = String(settings.panSpeed);
  
  return settings;
}

export function saveCurrentSettings(): void {
  const autoRenderEl = document.getElementById('autoRender') as HTMLInputElement | null;
  const previewWhileDragEl = document.getElementById('previewWhileDrag') as HTMLInputElement | null;
  const showHudEl = document.getElementById('showHud') as HTMLInputElement | null;
  const stgInvertScrollEl = document.getElementById('stgInvertScroll') as HTMLInputElement | null;
  const stgZoomSpeedEl = document.getElementById('stgZoomSpeed') as HTMLInputElement | null;
  const stgInvertPanXEl = document.getElementById('stgInvertPanX') as HTMLInputElement | null;
  const stgInvertPanYEl = document.getElementById('stgInvertPanY') as HTMLInputElement | null;
  const stgPanSpeedEl = document.getElementById('stgPanSpeed') as HTMLInputElement | null;
  
  const settings: Settings = {
    autoRender: autoRenderEl?.checked ?? false,
    previewWhileDrag: previewWhileDragEl?.checked ?? false,
    showHud: showHudEl?.checked ?? true,
    invertScroll: stgInvertScrollEl?.checked ?? false,
    zoomSpeed: stgZoomSpeedEl ? parseFloat(stgZoomSpeedEl.value) : 1.0,
    invertPanX: stgInvertPanXEl?.checked ?? false,
    invertPanY: stgInvertPanYEl?.checked ?? false,
    panSpeed: stgPanSpeedEl ? parseFloat(stgPanSpeedEl.value) : 1.0,
    suppressWelcomeDialog: loadSettings().suppressWelcomeDialog
  };
  
  saveSettings(settings);
}
