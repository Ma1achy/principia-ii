import type { GpuContext } from './init.js';
import { sizeOfSimResult, sizeOfICDescriptor } from './structs.js';

export interface TileBuffers {
  uniforms:    GPUBuffer;
  tileReq:     GPUBuffer;
  simResults:  GPUBuffer;
  icDesc:      GPUBuffer;
  readback:    GPUBuffer;       // optional, M=8 size for one tile
  debug:       GPUBuffer;       // G17 DebugUniform (16B); zero-filled = mode 0 (M3 colouring)
  N:           number;
  M:           number;
}

export function createTileBuffers(
  ctx: GpuContext, N: number, M: number,
): TileBuffers {
  const { device } = ctx;

  const uniforms   = device.createBuffer({
    size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const tileReq    = device.createBuffer({
    size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const simResults = device.createBuffer({
    size: sizeOfSimResult(M) * N * N,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  const icDesc     = device.createBuffer({
    size: sizeOfICDescriptor() * N * N,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  const readback   = device.createBuffer({
    size: sizeOfSimResult(M) * N * N,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

  const debug      = device.createBuffer({
    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  return { uniforms, tileReq, simResults, icDesc, readback, debug, N, M };
}
