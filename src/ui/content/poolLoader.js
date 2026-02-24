/**
 * @fileoverview Button label pool loader
 * Loads button label pools from JSON files
 */

/**
 * Load button label pools from JSON files
 * @param {string[]} poolFiles - Array of JSON file paths relative to pools/labels/ directory
 * @returns {Promise<Object>} Loaded pools object
 */
export async function loadButtonPools(poolFiles) {
  const pools = {};
  const basePath = '/src/ui/content/pools/labels/';
  
  for (const file of poolFiles) {
    try {
      const response = await fetch(basePath + file);
      if (!response.ok) {
        console.error(`[PoolLoader] Failed to load ${file}: ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      
      // Merge pools from this file
      Object.assign(pools, data);
      
      console.log(`[PoolLoader] Loaded ${Object.keys(data).length} pool(s) from ${file}`);
    } catch (err) {
      console.error(`[PoolLoader] Error loading ${file}:`, err);
    }
  }
  
  return pools;
}

/**
 * Preload button pools at app startup
 * Call this early in your app initialization
 * @returns {Promise<Object>} Loaded pools
 */
export async function preloadButtonPools() {
  console.log('[PoolLoader] Preloading button label pools...');
  
  const pools = await loadButtonPools([
    'welcomeBtn.json',
    'dialogRenderCancelBtn.json',
    'dialogRenderAcceptBtn.json',
    'dialogRenderBtnPairs.json'
    // Add more JSON files here as you create them:
    // 'resolutionWarning.json',
    // 'controlPanel.json',
    // etc.
  ]);
  
  console.log(`[PoolLoader] Preload complete: ${Object.keys(pools).length} total pool(s)`);
  return pools;
}
