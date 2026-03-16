/**
 * TreeNavigationBridge - Reactive reconciliation layer
 * Subscribes to tree events and updates navigation manager
 */

export class TreeNavigationBridge {
  constructor(uiTree, adapter, navManager) {
    this.uiTree = uiTree;
    this.adapter = adapter;
    this.navManager = navManager;
    
    this._setupListeners();
  }

  /**
   * Setup event listeners for tree mutations
   */
  _setupListeners() {
    // Node updated: rebuild subtree
    this.uiTree.on('node:updated', this._handleNodeUpdated.bind(this));
    
    // Nodes added: rebuild common ancestor
    this.uiTree.on('nodes:added', this._handleNodesAdded.bind(this));
    
    // Node removed: restore focus to parent
    this.uiTree.on('node:removed', this._handleNodeRemoved.bind(this));
    
    // Subtree removed: restore focus to parent
    this.uiTree.on('subtree:removed', this._handleSubtreeRemoved.bind(this));
    
    // Overlay registered: open overlay in nav manager
    this.uiTree.on('overlay:registered', this._handleOverlayRegistered.bind(this));
    
    // Overlay removed: close overlay in nav manager
    this.uiTree.on('overlay:removed', this._handleOverlayRemoved.bind(this));
  }

  /**
   * Handle node update
   * @param {Object} event - { id, updates }
   */
  _handleNodeUpdated(event) {
    const { id } = event;
    
    // New grid-based KNM reads directly from UITreeStore, no sync needed
    console.log('[Bridge] Node updated:', id);
  }

  /**
   * Handle nodes added
   * @param {Object} event - { ids }
   */
  _handleNodesAdded(event) {
    const { ids } = event;
    
    // New grid-based KNM reads directly from UITreeStore, no sync needed
    console.log('[Bridge] Nodes added:', ids);
  }

  /**
   * Handle node removal
   * @param {Object} event - { id, parentId }
   */
  _handleNodeRemoved(event) {
    const { id, parentId } = event;
    
    // If focused node was removed, restore focus to parent
    const currentFocus = this.navManager.sessionState?.currentFocusId;
    if (currentFocus === id && parentId) {
      this.navManager._setFocus(parentId);
    }
    
    // Node stays in UITreeStore, just marked as removed/hidden
    console.log('[Bridge] Node removed:', id);
  }

  /**
   * Handle subtree removal
   * @param {Object} event - { rootId, removedIds }
   */
  _handleSubtreeRemoved(event) {
    const { rootId, removedIds } = event;
    
    // Check if any removed node was focused
    const currentFocus = this.navManager.sessionState?.currentFocusId;
    if (removedIds.includes(currentFocus)) {
      // Restore focus to nearest ancestor
      const ancestorId = this.uiTree.getNearestAncestor(rootId);
      if (ancestorId) {
        this.navManager._setFocus(ancestorId);
      }
    }
    
    // Nodes stay in UITreeStore, just marked as removed/hidden
    console.log('[Bridge] Subtree removed:', rootId, removedIds.length, 'nodes');
  }

  /**
   * Handle overlay registration
   * @param {Object} event - { id, triggerId }
   */
  _handleOverlayRegistered(event) {
    const { id, triggerId } = event;
    
    console.log('[Bridge] Overlay registered:', id, 'trigger:', triggerId);
    
    // New grid-based KNM reads directly from UITreeStore, no need to build subtree
    
    console.log('[Bridge] Opening overlay in nav manager...');
    this.navManager.openOverlayById(id, triggerId);
  }

  /**
   * Handle overlay removal
   * @param {Object} event - { id, triggerId }
   */
  _handleOverlayRemoved(event) {
    const { id, triggerId } = event;
    
    // Close overlay (will restore focus automatically)
    this.navManager.closeOverlay(id);
    
    // Nodes stay in UITreeStore, just marked as removed/hidden
    console.log('[Bridge] Overlay removed:', id);
  }

  /**
   * Cleanup listeners
   */
  destroy() {
    this.uiTree.off('node:updated', this._handleNodeUpdated);
    this.uiTree.off('nodes:added', this._handleNodesAdded);
    this.uiTree.off('node:removed', this._handleNodeRemoved);
    this.uiTree.off('subtree:removed', this._handleSubtreeRemoved);
    this.uiTree.off('overlay:registered', this._handleOverlayRegistered);
    this.uiTree.off('overlay:removed', this._handleOverlayRemoved);
  }
}
