/**
 * SemanticTreeAdapter - Converts UITree to Navigation Tree
 * Builds flat navigation tree with behaviors attached
 */

/**
 * Semantic Tree Adapter
 * Converts semantic UI tree to navigation tree format
 */
export class SemanticTreeAdapter {
  constructor(uiTree, behaviorRegistry, behaviorDeps = {}) {
    this.uiTree = uiTree;
    this.behaviorRegistry = behaviorRegistry;
    this.behaviorDeps = behaviorDeps;
  }

  /**
   * Build navigation tree from semantic UI tree
   * @returns {Object} Flat map of navigation nodes { [id]: node }
   */
  buildNavigationTree() {
    const navTree = {};
    const nodes = this.uiTree.toJSON().nodes;

    // Convert all nodes
    nodes.forEach(uiNode => {
      const navNode = this._convertNode(uiNode);
      if (navNode) {
        navTree[navNode.id] = navNode;
      }
    });

    return navTree;
  }

  /**
   * Convert a single UI node to navigation node
   * @param {Object} uiNode - UI tree node
   * @returns {Object} Navigation node
   */
  _convertNode(uiNode) {
    const element = this.uiTree.getElement(uiNode.id);
    
    // Create base navigation node
    const navNode = {
      id: uiNode.id,
      kind: uiNode.kind,
      parentId: uiNode.parentId,
      children: uiNode.children || [],
      focusMode: uiNode.focusMode,
      strategy: uiNode.strategy || 'linear',
      entryPolicy: uiNode.entryPolicy || 'first',
      wrap: uiNode.wrap ?? false,
      overlay: uiNode.overlay || false,
      modal: uiNode.modal || false,
      hidden: uiNode.hidden || false,
      disabled: uiNode.disabled || false,
      primary: uiNode.primary || false,
      role: uiNode.role,
      ariaRole: uiNode.ariaRole,
      ariaLabel: uiNode.ariaLabel,
      fastActions: uiNode.fastActions || {},
      meta: uiNode.meta || {},
      element
    };

    // Attach behavior if registered
    if (this.behaviorRegistry.has(uiNode.kind)) {
      navNode.behavior = this.behaviorRegistry.create(
        uiNode.kind,
        navNode,
        element,
        this.behaviorDeps
      );
    } else if (uiNode.role && this.behaviorRegistry.has(uiNode.role)) {
      // Try role-based behavior
      navNode.behavior = this.behaviorRegistry.create(
        uiNode.role,
        navNode,
        element,
        this.behaviorDeps
      );
    }

    return navNode;
  }

  /**
   * Rebuild a subtree (for dynamic updates)
   * @param {string} rootId - Root node ID
   * @returns {Object} Flat map of rebuilt nodes { [id]: node }
   */
  rebuildSubtree(rootId) {
    const subtreeMap = {};
    
    const collectSubtree = (nodeId) => {
      const uiNode = this.uiTree.getNode(nodeId);
      if (!uiNode) return;

      const navNode = this._convertNode(uiNode);
      if (navNode) {
        subtreeMap[navNode.id] = navNode;
      }

      if (uiNode.children?.length) {
        uiNode.children.forEach(childId => collectSubtree(childId));
      }
    };

    collectSubtree(rootId);
    return subtreeMap;
  }

  /**
   * Get root node ID
   * @returns {string|null} Root node ID
   */
  getRootId() {
    const root = this.uiTree.getRoot();
    return root?.id || null;
  }
}
