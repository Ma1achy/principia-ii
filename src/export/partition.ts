/**
 * Decide how to partition a full-retention output buffer when its total
 * size would exceed `maxStorageBufferBindingSize`.
 *
 * Returns a list of sub-buffer descriptors in row-major order: each
 * entry tells you which row range to fill and how big its buffer is.
 */
export interface SubBufferPlan {
  rowStart:    number;
  rowCount:    number;
  byteOffset:  number;
  byteSize:    number;
}

export function partitionBuffer(
  width: number, height: number, bytesPerSample: number,
  maxBindingSize: number,
): SubBufferPlan[] {
  const totalBytes = width * height * bytesPerSample;
  if (totalBytes <= maxBindingSize) {
    return [{ rowStart: 0, rowCount: height,
              byteOffset: 0, byteSize: totalBytes }];
  }
  const rowsPerBuf = Math.max(1, Math.floor(maxBindingSize / (width * bytesPerSample)));
  const plans: SubBufferPlan[] = [];
  let row = 0;
  while (row < height) {
    const rows = Math.min(rowsPerBuf, height - row);
    plans.push({
      rowStart: row, rowCount: rows,
      byteOffset: row * width * bytesPerSample,     // global offset for assembly
      byteSize:   rows * width * bytesPerSample,
    });
    row += rows;
  }
  return plans;
}
