/**
 * PNG export of the current rendered frame. M12 documents the contract;
 * the actual encoding uses Canvas API (`canvas.toBlob`) in the browser
 * or `pngjs` in Node-side tests.
 */
export interface PngEncoder {
  encode(rgba: Uint8ClampedArray, width: number, height: number): Promise<Blob | ArrayBuffer>;
}
