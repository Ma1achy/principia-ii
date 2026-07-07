import type { ViewState } from '@/interact/view_state.js';
import { defaultViewState } from '@/interact/view_state.js';

/** The subset of ViewState a preset captures. Excludes lock state,
 *  timestamps, the viewport window, and (by construction) all render-only
 *  RenderParams — a preset is a *chart/view*, not a *look*. */
export type PresetView = Pick<ViewState,
  | 'chartType' | 'chartParams'
  | 'z0' | 'hAxis' | 'vAxis' | 'q1' | 'q2' | 'mag'
  | 'rotation' | 'tilt1' | 'tilt2' | 'tilt1Target' | 'tilt2Target'
  | 'integrator' | 'THorizon' | 'dtMacro' | 'NMax' | 'checkpoints'
  | 'qualityTier' | 'samplesPerAxis' | 'maxDepth' | 'ensembleCount'>;

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly builtin: boolean;
  readonly view: PresetView;
}

const PRESET_FIELDS: ReadonlyArray<keyof PresetView> = [
  'chartType', 'chartParams', 'z0', 'hAxis', 'vAxis', 'q1', 'q2', 'mag',
  'rotation', 'tilt1', 'tilt2', 'tilt1Target', 'tilt2Target',
  'integrator', 'THorizon', 'dtMacro', 'NMax', 'checkpoints',
  'qualityTier', 'samplesPerAxis', 'maxDepth', 'ensembleCount',
];

/** Extract the preset-capturable subset from a live ViewState. Pure. */
export function captureView(v: ViewState): PresetView {
  const out = {} as Record<keyof PresetView, unknown>;
  for (const k of PRESET_FIELDS) out[k] = v[k];
  return out as unknown as PresetView;
}

/** Merge a preset's captured fields over the current view, returning a
 *  fresh, unlocked ViewState with a refreshed timestamp. Render-only fields
 *  (not part of ViewState) are untouched — they live in the separate
 *  RenderParams store. */
export function applyPreset(current: ViewState, p: Preset): ViewState {
  return {
    ...current,
    ...p.view,
    locked: false,
    lockedPhysical: undefined,
    timestamp: new Date().toISOString(),
  };
}

/** Make a saved (user) preset from the live view. Pure; id is caller-supplied. */
export function savePreset(id: string, name: string, v: ViewState): Preset {
  return { id, name, builtin: false, view: captureView(v) };
}

/** Built-in gallery. Frozen so the UI cannot mutate them in place. */
export const BUILTIN_PRESETS: readonly Preset[] = Object.freeze([
  Object.freeze({
    id: 'home', name: 'Home (latent slice)', builtin: true,
    view: captureView(defaultViewState()),
  }),
  Object.freeze({
    id: 'lz_e', name: '(L_z, E) overview', builtin: true,
    view: captureView({ ...defaultViewState(), chartType: 'lz_e', mag: 4 }),
  }),
  Object.freeze({
    id: 'shape_sphere', name: 'Shape sphere', builtin: true,
    view: captureView({ ...defaultViewState(), chartType: 'shape_sphere' }),
  }),
] as const);

/**
 * Minimal preset registry: built-ins plus user-saved presets. `save`
 * returns a NEW registry (immutable) so built-ins are never replaced.
 * Lookups are by id.
 */
export class PresetStore {
  constructor(private readonly items: readonly Preset[] = BUILTIN_PRESETS) {}

  all(): readonly Preset[] { return this.items; }
  get(id: string): Preset | undefined { return this.items.find(p => p.id === id); }

  /** Add or replace a USER preset. Throws if `id` collides with a built-in. */
  save(p: Preset): PresetStore {
    if (p.builtin) throw new Error('cannot save a builtin preset');
    const existing = this.get(p.id);
    if (existing?.builtin) throw new Error(`"${p.id}" is a builtin and is read-only`);
    const rest = this.items.filter(x => x.id !== p.id);
    return new PresetStore([...rest, p]);
  }

  remove(id: string): PresetStore {
    const t = this.get(id);
    if (t?.builtin) throw new Error(`"${id}" is a builtin and cannot be removed`);
    return new PresetStore(this.items.filter(p => p.id !== id));
  }
}
