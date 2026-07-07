import type { GpuDispatcher, FrameDeps } from './types.js';
import { Store } from './store.js';
import { InputHandlers } from './input.js';
import { FrameLoop } from './frame_loop.js';
import type { Viewport } from './view_bridge.js';
import type { ViewState } from '@/interact/view_state.js';
import { defaultViewState } from '@/interact/view_state.js';
import type { InspectorResult } from '@/inspector/types.js';

export interface AppOpts {
  initialView?:     ViewState;
  frameBudget?:     number;
  maxInFlight?:     number;
  ftleEnabled?:     boolean;
  ensembleEnabled?: boolean;
  viewport?:        Viewport;
}

/** Top-level facade. The DOM bindings (canvas mounting, button clicks)
 *  call methods on this object; the loop runs underneath. */
export class App {
  readonly store: Store;
  readonly input: InputHandlers;
  readonly loop:  FrameLoop;
  private inspectorPromise: Promise<InspectorResult> | null = null;

  constructor(
    dispatcher: GpuDispatcher,
    deps:       FrameDeps,
    opts:       AppOpts = {},
  ) {
    this.store = new Store(opts.initialView ?? defaultViewState());
    this.input = new InputHandlers(this.store);
    this.loop = new FrameLoop(this.store, dispatcher, deps, {
      frameBudget:     opts.frameBudget     ?? 16,
      maxInFlight:     opts.maxInFlight     ?? 4,
      ftleEnabled:     opts.ftleEnabled     ?? false,
      ensembleEnabled: opts.ensembleEnabled ?? false,
      ...(opts.viewport ? { viewport: opts.viewport } : {}),
    });

    // Inspector lifecycle owns three signals: lock fired (kick the f64
    // inspector exactly once), unlock fired (drop the promise), chart
    // switch (preserve keeps the lock, so the promise survives).
    let prevLocked = this.store.snapshot().locked;
    this.store.subscribe((v) => {
      if (v.locked && !prevLocked && v.lockedPhysical) {
        this.inspectorPromise = dispatcher.inspect(v, {
          m: v.lockedPhysical.m,
          r: v.lockedPhysical.r,
          p: v.lockedPhysical.p,
          t: 0,
        });
      } else if (!v.locked) {
        this.inspectorPromise = null;
      }
      prevLocked = v.locked;
    });
  }

  start(): void { this.loop.start(); }
  stop():  void { this.loop.stop(); }

  /** Promise of the currently-locked inspector result, or null when
   *  unlocked. The UI binds the validation panel to this. */
  inspector(): Promise<InspectorResult> | null {
    return this.inspectorPromise;
  }
}
