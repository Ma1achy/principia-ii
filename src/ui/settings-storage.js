const SETTINGS_KEY = 'principia_settings';

const DEFAULT_SETTINGS = {
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

export function loadSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  } catch (e) {
    console.error('[Settings] Failed to load:', e);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('[Settings] Failed to save:', e);
  }
}

export function applySavedSettings() {
  const settings = loadSettings();
  
  document.getElementById('autoRender').checked = settings.autoRender;
  document.getElementById('previewWhileDrag').checked = settings.previewWhileDrag;
  document.getElementById('showHud').checked = settings.showHud;
  document.getElementById('stgInvertScroll').checked = settings.invertScroll;
  document.getElementById('stgZoomSpeed').value = settings.zoomSpeed;
  document.getElementById('stgZoomSpeedVal').value = settings.zoomSpeed;
  document.getElementById('stgInvertPanX').checked = settings.invertPanX;
  document.getElementById('stgInvertPanY').checked = settings.invertPanY;
  document.getElementById('stgPanSpeed').value = settings.panSpeed;
  document.getElementById('stgPanSpeedVal').value = settings.panSpeed;
  
  return settings;
}

export function saveCurrentSettings() {
  const settings = {
    autoRender: document.getElementById('autoRender').checked,
    previewWhileDrag: document.getElementById('previewWhileDrag').checked,
    showHud: document.getElementById('showHud').checked,
    invertScroll: document.getElementById('stgInvertScroll').checked,
    zoomSpeed: parseFloat(document.getElementById('stgZoomSpeed').value),
    invertPanX: document.getElementById('stgInvertPanX').checked,
    invertPanY: document.getElementById('stgInvertPanY').checked,
    panSpeed: parseFloat(document.getElementById('stgPanSpeed').value),
    suppressWelcomeDialog: loadSettings().suppressWelcomeDialog
  };
  
  saveSettings(settings);
}
