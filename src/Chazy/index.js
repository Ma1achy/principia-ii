/**
 * Chazy — Subtitle System
 * ─────────────────────────────────────────────────────────────────────────
 * Named after Jean Chazy, who classified three-body problem final states.
 * 
 * Architecture:
 * 1. TextStateMachine — Animation FSM (IDLE → TYPING → DISPLAY → DELETING)
 * 2. ChazyMind — Emotional AI that reacts to simulation events
 * 3. FlavourText — Text selection, timing, mode matching (coordinating layer)
 */

export { TextStateMachine } from './textStateMachine.js';
export { ChazyMind } from './chazy.js';
