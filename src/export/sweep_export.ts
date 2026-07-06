import type { Timeline } from './types.js';
import type { ViewState } from '@/interact/view_state.js';
import { evaluateTimeline } from './timeline.js';

/**
 * Animated sweep executor. For each frame: evaluate the timeline,
 * dispatch a flat static render, write the output frame.
 */
export interface SweepWriter {
  writeFrame: (frame: number, image: ArrayBuffer) => Promise<void>;
  writeSidecar: (sidecar: { schema: 'principia.sidecar.v1'; timeline: Timeline }) => Promise<void>;
}

export async function runSweep(
  tl: Timeline,
  renderFrame: (view: ViewState, frameIndex: number) => Promise<ArrayBuffer>,
  writer: SweepWriter,
): Promise<void> {
  for (let f = 0; f < tl.durationFrames; f++) {
    const view  = evaluateTimeline(tl, f);
    const image = await renderFrame(view, f);
    await writer.writeFrame(f, image);
  }
  if (tl.output.includeSidecar) {
    await writer.writeSidecar({ schema: 'principia.sidecar.v1', timeline: tl });
  }
}
