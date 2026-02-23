/**
 * Interrupt Urgency System - Constants and Utilities
 * ─────────────────────────────────────────────────────
 * Defines urgency levels for interrupt system and maps events to urgency.
 * 
 * Urgency Levels:
 * 0 (OBSERVATIONAL) - Don't interrupt, just observe
 * 1 (POLITE) - Wait for good moment (IDLE/DISPLAY)
 * 2 (ASSERTIVE) - Interrupt TYPING/DISPLAY, queue during DELETING
 * 3 (FORCE) - Always interrupt, even during DELETING
 */

export const INTERRUPT_URGENCY = {
  OBSERVATIONAL: 0,  // Background events (don't interrupt)
  POLITE: 1,         // Tentative actions (wait for good moment)
  ASSERTIVE: 2,      // Committed actions (interrupt typing)
  FORCE: 3           // Destructive actions (override everything)
};

/**
 * Maps event types to urgency levels
 */
export const EVENT_URGENCY_MAP = {
  // Level 0: Observational (no interrupt, just observe)
  'orientation_adjustment': INTERRUPT_URGENCY.OBSERVATIONAL,
  'render_started': INTERRUPT_URGENCY.OBSERVATIONAL,
  'slider_hover': INTERRUPT_URGENCY.OBSERVATIONAL,        // Just hovering over slider
  'select_hover': INTERRUPT_URGENCY.OBSERVATIONAL,        // Just hovering over dropdown
  
  // Level 1: Polite (wait for good moment)
  'button_hesitation': INTERRUPT_URGENCY.POLITE,          // Hovering over button
  'slider_exploration': INTERRUPT_URGENCY.POLITE,         // Dragging slider (old)
  'slider_changed': INTERRUPT_URGENCY.POLITE,             // Slider value changed
  'select_changed': INTERRUPT_URGENCY.POLITE,             // Dropdown changed
  'preset_browsing': INTERRUPT_URGENCY.POLITE,            // Looking at presets
  
  // Level 2: Assertive (interrupt typing/display, queue during deletion)
  'button_click_render': INTERRUPT_URGENCY.ASSERTIVE,
  'button_click_share': INTERRUPT_URGENCY.ASSERTIVE,
  'button_click_save': INTERRUPT_URGENCY.ASSERTIVE,
  'button_click_copy': INTERRUPT_URGENCY.ASSERTIVE,
  'button_click_zero_z0': INTERRUPT_URGENCY.ASSERTIVE,
  'button_click_randomize_z0': INTERRUPT_URGENCY.ASSERTIVE,
  'button_click_reset_tilts': INTERRUPT_URGENCY.ASSERTIVE,
  'button_click_apply_json': INTERRUPT_URGENCY.ASSERTIVE,
  'button_click_download_json': INTERRUPT_URGENCY.ASSERTIVE,
  'mode_changed': INTERRUPT_URGENCY.ASSERTIVE,
  'preset_changed': INTERRUPT_URGENCY.ASSERTIVE,
  
  // Level 3: Force (override everything, even mid-deletion)
  'button_click_reset': INTERRUPT_URGENCY.FORCE,          // DESTRUCTIVE
  'state_reset': INTERRUPT_URGENCY.FORCE,                 // DESTRUCTIVE
  'render_completed': INTERRUPT_URGENCY.FORCE,            // Important feedback
  'render_aborted': INTERRUPT_URGENCY.FORCE               // Error state
};

/**
 * Get urgency level for an event type
 * @param {string} eventType - Event type name
 * @returns {number} Urgency level (0-3)
 */
export function getEventUrgency(eventType) {
  if (!eventType || typeof eventType !== 'string') {
    console.warn('[InterruptUrgency] Invalid eventType:', eventType);
    return INTERRUPT_URGENCY.ASSERTIVE; // Safe default
  }
  return EVENT_URGENCY_MAP[eventType] ?? INTERRUPT_URGENCY.ASSERTIVE;
}

/**
 * Get priority level for an event based on urgency
 * @param {string} eventType - Event type name
 * @param {number} urgency - Urgency level (0-3)
 * @returns {number} Priority level (1-3)
 */
export function getEventPriority(eventType, urgency) {
  // Validate urgency is a number
  if (typeof urgency !== 'number' || isNaN(urgency)) {
    console.warn('[InterruptUrgency] Invalid urgency:', urgency);
    urgency = INTERRUPT_URGENCY.ASSERTIVE;
  }
  
  // Clamp urgency to valid range
  urgency = Math.max(0, Math.min(3, urgency));
  
  // Force urgency events get priority 3 (override anything)
  if (urgency === INTERRUPT_URGENCY.FORCE) {
    return 3;
  }
  
  // Assertive gets priority 2 (override ambient)
  if (urgency === INTERRUPT_URGENCY.ASSERTIVE) {
    return 2;
  }
  
  // Polite and observational get priority 1 (same as ambient)
  return 1;
}
