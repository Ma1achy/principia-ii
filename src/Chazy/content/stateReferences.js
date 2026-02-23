/**
 * State References Provider
 * 
 * Provides current application state for dynamic template references in Chazy's lines.
 * Called once per interaction to get a fresh state snapshot.
 */

import { state, MODE_INFO, AXIS_NAMES } from '../../state.js';

/**
 * Get current application state for template references
 * 
 * @param {Object} eventData - Optional event-specific data
 * @param {*} eventData.newValue - New value after change (for sliders/selects)
 * @param {*} eventData.oldValue - Previous value before change
 * @param {number} eventData.delta - Amount of change (for sliders)
 * @param {string} eventData.slider - Slider identifier
 * @param {string} eventData.select - Select/dropdown identifier
 * @param {string} eventData.button - Button identifier
 * @returns {Object} Map of reference keys to formatted values
 */
export function getStateReferences(eventData = {}) {
  return {
    // ─── Render Settings ───
    resolution: state.res ? `${state.res}×${state.res}` : '?',
    resolution_int: state.res,
    render_mode: MODE_INFO[state.mode]?.name || 'Unknown',
    render_mode_num: state.mode,
    
    // ─── Slice Coordinates ───
    z0: state.z0?.[0]?.toFixed(2) || '?',
    z1: state.z0?.[1]?.toFixed(2) || '?',
    z2: state.z0?.[2]?.toFixed(2) || '?',
    z3: state.z0?.[3]?.toFixed(2) || '?',
    z4: state.z0?.[4]?.toFixed(2) || '?',
    z5: state.z0?.[5]?.toFixed(2) || '?',
    z6: state.z0?.[6]?.toFixed(2) || '?',
    z7: state.z0?.[7]?.toFixed(2) || '?',
    z8: state.z0?.[8]?.toFixed(2) || '?',
    z9: state.z0?.[9]?.toFixed(2) || '?',
    z_coords: state.z0?.map(v => v.toFixed(2)).join(', ') || '?',
    
    // ─── Axis Names ───
    z0_name: AXIS_NAMES[0] || 'z₀',
    z1_name: AXIS_NAMES[1] || 'z₁',
    z2_name: AXIS_NAMES[2] || 'z₂',
    z3_name: AXIS_NAMES[3] || 'z₃',
    z4_name: AXIS_NAMES[4] || 'z₄',
    z5_name: AXIS_NAMES[5] || 'z₅',
    z6_name: AXIS_NAMES[6] || 'z₆',
    z7_name: AXIS_NAMES[7] || 'z₇',
    z8_name: AXIS_NAMES[8] || 'z₈',
    z9_name: AXIS_NAMES[9] || 'z₉',
    
    // ─── Simulation Parameters ───
    horizon: state.horizon?.toString() || '?',
    horizon_int: Math.round(state.horizon || 0).toString(),
    max_steps: state.maxSteps?.toLocaleString() || '?',
    max_steps_k: ((state.maxSteps || 0) / 1000).toFixed(0) + 'k',
    dt_macro: state.dtMacro?.toFixed(4) || '?',
    r_coll: state.rColl?.toFixed(3) || '?',
    r_esc: state.rEsc?.toFixed(2) || '?',
    
    // ─── Orientation ───
    tilt_dim1: state.tiltDim1,
    tilt_dim2: state.tiltDim2,
    tilt_q1: state.tiltAmt1?.toFixed(2) || '?',
    tilt_q2: state.tiltAmt2?.toFixed(2) || '?',
    
    // ─── Computed/Conditional ───
    is_high_res: state.res > 1024,
    res_quality: state.res > 2048 ? 'ultra' : state.res > 1024 ? 'high' : 'low',
    total_dims: state.z0?.length || 10,
    
    // ─── Event-Specific (from eventData) ───
    new_value: eventData.newValue?.toString() || '?',
    old_value: eventData.oldValue?.toString() || '?',
    delta: eventData.delta?.toFixed(2) || '?',
    slider_name: eventData.slider || '?',
    select_name: eventData.select || '?',
    button_name: eventData.button || '?',
  };
}
