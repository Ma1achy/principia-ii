import { describe, it, expect } from 'vitest';
import {
  DebugMode, DEBUG_MODES, debugModeLabel, packDebugUniform,
} from '@/debug/debug_modes.js';

describe('debug modes', () => {
  it('DEBUG_MODES is total over the enum values', () => {
    const enumVals = Object.values(DebugMode).filter((v) => typeof v === 'number') as number[];
    const lutVals = DEBUG_MODES.map((m) => m.mode);
    expect(new Set(lutVals)).toEqual(new Set(enumVals));
    expect(DEBUG_MODES).toHaveLength(enumVals.length);
  });

  it('every swatch is a valid sRGB triple', () => {
    for (const m of DEBUG_MODES) {
      expect(m.swatch).toHaveLength(3);
      for (const c of m.swatch) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
    }
  });

  it('debugModeLabel never throws and falls through for reserved values', () => {
    expect(debugModeLabel(DebugMode.Outcome)).toBe('Outcome class');
    expect(debugModeLabel(99)).toBe('MODE99');
  });

  it('packDebugUniform is 16 bytes; mode/scale/checkpoints round-trip', () => {
    const buf = packDebugUniform(DebugMode.EnergyDriftHeat, 2e-3, 8);
    expect(buf.byteLength).toBe(16);
    const f = new Float32Array(buf); const u = new Uint32Array(buf);
    expect(f[0]).toBe(DebugMode.EnergyDriftHeat);
    expect(f[1]).toBeCloseTo(2e-3, 9);
    expect(u[2]).toBe(8);
  });

  it('packDebugUniform clamps a non-positive heat scale to 1', () => {
    expect(new Float32Array(packDebugUniform(DebugMode.EnergyDriftHeat, 0, 8))[1]).toBe(1);
  });
});
