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
 * 6. InterruptPredictor — Mouse trajectory prediction for pre-warming
 * 7. InterruptTimingCalibrator — Learns user's interrupt timing preferences
 */

export { Chazy } from './ChazyOrchestrator.js';
export { ChazyView } from './animation/ChazyView.js';
export { ChazyMind } from './mind/chazyMind.js';
export { TextSelector } from './content/textSelector.js';
export { TextStateMachine } from './animation/textStateMachine.js';
export { InterruptPredictor } from './events/interruptPredictor.js';
export { InterruptTimingCalibrator } from './events/interruptTimingCalibrator.js';
export { INTERRUPT_URGENCY, getEventUrgency, getEventPriority } from './events/interruptUrgency.js';
