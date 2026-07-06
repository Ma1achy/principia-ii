// Single dev-side shader glue (G1). Owns the Vite `?raw` imports (tsc never
// sees this file — dev/ is outside tsconfig's include) and links each
// pipeline's module with wgslLink. Replaces the per-page hand-ordered
// `[...].join('\n')` concatenation from M3/M7.

import { wgslLink } from '@/gpu/wgsl/link.js';

import helpersWgsl from '@/gpu/shaders/helpers.wgsl?raw';
import observeWgsl from '@/gpu/shaders/observe.wgsl?raw';
import eventsWgsl from '@/gpu/shaders/events.wgsl?raw';
import integrateWgsl from '@/gpu/shaders/integrate.wgsl?raw';
import decodeWgsl from '@/gpu/shaders/decode.wgsl?raw';
import simulateWgsl from '@/gpu/shaders/simulate.wgsl?raw';
import reduceWgsl from '@/gpu/shaders/reduce.wgsl?raw';
import renderLayer0Wgsl from '@/gpu/shaders/render_layer0.wgsl?raw';
import renderHelpersWgsl from '@/gpu/shaders/render_helpers.wgsl?raw';
import colourModesWgsl from '@/gpu/shaders/colour_modes.wgsl?raw';
import brightnessModesWgsl from '@/gpu/shaders/brightness_modes.wgsl?raw';
import combinerWgsl from '@/gpu/shaders/combiner.wgsl?raw';
import cvdWgsl from '@/gpu/shaders/cvd.wgsl?raw';
import renderGraphWgsl from '@/gpu/shaders/render_graph.wgsl?raw';

const SOURCES: Record<string, string> = {
  'helpers.wgsl': helpersWgsl,
  'observe.wgsl': observeWgsl,
  'events.wgsl': eventsWgsl,
  'integrate.wgsl': integrateWgsl,
  'decode.wgsl': decodeWgsl,
  'simulate.wgsl': simulateWgsl,
  'reduce.wgsl': reduceWgsl,
  'render_layer0.wgsl': renderLayer0Wgsl,
  'render_helpers.wgsl': renderHelpersWgsl,
  'colour_modes.wgsl': colourModesWgsl,
  'brightness_modes.wgsl': brightnessModesWgsl,
  'combiner.wgsl': combinerWgsl,
  'cvd.wgsl': cvdWgsl,
  'render_graph.wgsl': renderGraphWgsl,
};

/** M3 compute module: helpers/observe/events/integrate/decode + simulate entry. */
export const SIMULATE_MODULE: string =
  wgslLink({ entryPath: 'simulate.wgsl', sources: SOURCES }).module;

/** M7 render-graph module (render_helpers owns PI; helpers.wgsl is never linked in). */
export const RENDER_GRAPH_MODULE: string =
  wgslLink({ entryPath: 'render_graph.wgsl', sources: SOURCES }).module;

/** M3/G17 layer-0 fragment shader — standalone single-unit module. */
export const RENDER_LAYER0_MODULE: string =
  wgslLink({ entryPath: 'render_layer0.wgsl', sources: SOURCES }).module;

/** M5 tile-reduction compute module — standalone single-unit module. */
export const REDUCE_MODULE: string =
  wgslLink({ entryPath: 'reduce.wgsl', sources: SOURCES }).module;
