/**
 * State References Provider
 * 
 * Provides current application state for dynamic template references in Chazy's lines.
 * Called once per interaction to get a fresh state snapshot.
 */

import { state, MODE_INFO, AXIS_NAMES } from '../../state.js';

interface EventData {
  newValue?: any;
  oldValue?: any;
  delta?: number;
  slider?: string;
  select?: string;
  button?: string;
}

export interface StateReferences {
  resolution: string;
  resolution_int: number;
  render_mode: string;
  render_mode_num: number;
  z0: string;
  z1: string;
  z2: string;
  z3: string;
  z4: string;
  z5: string;
  z6: string;
  z7: string;
  z8: string;
  z9: string;
  z_coords: string;
  z0_name: string;
  z1_name: string;
  z2_name: string;
  z3_name: string;
  z4_name: string;
  z5_name: string;
  z6_name: string;
  z7_name: string;
  z8_name: string;
  z9_name: string;
  horizon: string;
  horizon_int: string;
  max_steps: string;
  max_steps_k: string;
  dt_macro: string;
  r_coll: string;
  r_esc: string;
  tilt_dim1: number;
  tilt_dim2: number;
  tilt_q1: string;
  tilt_q2: string;
  is_high_res: boolean;
  res_quality: 'ultra' | 'high' | 'low';
  total_dims: number;
  new_value: string;
  old_value: string;
  delta: string;
  slider_name: string;
  select_name: string;
  button_name: string;
}

/**
 * Get current application state for template references
 */
export function getStateReferences(eventData: EventData = {}): StateReferences {
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
