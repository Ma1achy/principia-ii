import type { ViewState } from '@/interact/view_state.js';

export type EasingName =
  | 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'
  | 'hold'   | 'log'     | 'step';

export type OutputFormat = 'png' | 'json' | 'binary' | 'csv' | 'npz' | 'both';

export interface TimelineTrack<T = any> {
  /** Dotted path into a ViewState, e.g. "z0[3]" or "chartParams.nu". */
  path:      string;
  keyframes: { frame: number; value: T; easing: EasingName }[];
}

export interface Timeline {
  base:            ViewState;
  durationFrames:  number;
  framerate?:      number;
  tracks:          TimelineTrack[];
  output: {
    format: OutputFormat;
    path:   string;
    includeSidecar: boolean;
  };
}

export interface SidecarV1 {
  schema:           'principia.sidecar.v1';
  principiaVersion: string;
  timestamp:        string;
  view:             ViewState;
  sha256:           string;
}
