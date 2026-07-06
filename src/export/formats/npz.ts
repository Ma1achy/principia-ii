/**
 * NPZ writer. Production uses a JS NumPy-zip implementation; M12 ships
 * the contract and a stub. The export pipeline declines to NPZ when the
 * library isn't loaded, falling back to binary.
 */
export interface NpzWriter {
  add(name: string, dtype: 'f32' | 'f64' | 'u32' | 'i32',
      shape: readonly number[], data: ArrayBuffer): void;
  finalise(): ArrayBuffer;
}
