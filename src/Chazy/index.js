/**
 * Chazy — Subtitle System
 * ─────────────────────────────────────────────────────────────────────────
 * Named after Jean Chazy, who classified three-body problem final states.
 * 
 * Architecture:
 * 1. Chazy — Main orchestrator (integrates all subsystems)
 * 2. ChazyView — Self-contained UI component (title + subtitle)
 * 3. ChazyMind — Emotional AI that reacts to simulation events
 * 4. TextSelector — Contextual text selection with emotional weighting
 * 5. TextStateMachine — Animation FSM (IDLE → TYPING → DISPLAY → DELETING)
 */

export { Chazy } from './ChazyOrchestrator.js';
export { ChazyView } from './ChazyView.js';
export { ChazyMind } from './chazyMind.js';
export { TextSelector } from './textSelector.js';
export { TextStateMachine } from './textStateMachine.js';
