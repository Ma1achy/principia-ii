import { updateSliderValue } from './utils/sliderUpdater.js';

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
  navDAS: number;
  navARR: number;
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
  navDAS: 200,
  navARR: 50,
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
  const stgNavDASEl = document.getElementById('stgNavDAS') as HTMLInputElement | null;
  const stgNavDASValEl = document.getElementById('stgNavDASVal') as HTMLInputElement | null;
  const stgNavARREl = document.getElementById('stgNavARR') as HTMLInputElement | null;
  const stgNavARRValEl = document.getElementById('stgNavARRVal') as HTMLInputElement | null;
  
  if (autoRenderEl) autoRenderEl.checked = settings.autoRender;
  if (previewWhileDragEl) previewWhileDragEl.checked = settings.previewWhileDrag;
  if (showHudEl) showHudEl.checked = settings.showHud;
  if (stgInvertScrollEl) stgInvertScrollEl.checked = settings.invertScroll;
  
  if (stgZoomSpeedEl) {
    // Convert zoom speed from decimal (0.2-4.0) to percentage (20-400%)
    updateSliderValue("stgZoomSpeed", settings.zoomSpeed * 100, {
      numberInputId: "stgZoomSpeedVal",
      decimals: 0
    });
  }
  
  if (stgInvertPanXEl) stgInvertPanXEl.checked = settings.invertPanX;
  if (stgInvertPanYEl) stgInvertPanYEl.checked = settings.invertPanY;
  
  if (stgNavDASEl) {
    updateSliderValue("stgNavDAS", settings.navDAS, {
      numberInputId: "stgNavDASVal"
    });
  }
  
  if (stgNavARREl) {
    updateSliderValue("stgNavARR", settings.navARR, {
      numberInputId: "stgNavARRVal"
    });
  }
  
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
  const stgNavDASEl = document.getElementById('stgNavDAS') as HTMLInputElement | null;
  const stgNavARREl = document.getElementById('stgNavARR') as HTMLInputElement | null;
  
  const settings: Settings = {
    autoRender: autoRenderEl?.checked ?? false,
    previewWhileDrag: previewWhileDragEl?.checked ?? false,
    showHud: showHudEl?.checked ?? true,
    invertScroll: stgInvertScrollEl?.checked ?? false,
    zoomSpeed: stgZoomSpeedEl ? parseFloat(stgZoomSpeedEl.value) / 100 : 1.0, // Convert from percentage to decimal
    invertPanX: stgInvertPanXEl?.checked ?? false,
    invertPanY: stgInvertPanYEl?.checked ?? false,
    navDAS: stgNavDASEl ? parseInt(stgNavDASEl.value) : 200,
    navARR: stgNavARREl ? parseInt(stgNavARREl.value) : 50,
    suppressWelcomeDialog: loadSettings().suppressWelcomeDialog
  };
  
  saveSettings(settings);
}
