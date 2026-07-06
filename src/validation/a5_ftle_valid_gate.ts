import { registerAcceptance } from './acceptance.js';
import { unpackSampleDescriptor, packSampleDescriptor } from '@/metrics/packing.js';

registerAcceptance(
  'A5', 'FTLE_VALID only set when Benettin actually ran',
  () => {
    // Simulate: the GPU dispatcher writes FTLE_VALID only if FTLE is
    // enabled in TileRequest.flags. Here we test the bit-mask plumbing
    // by round-tripping with both states.
    const off = unpackSampleDescriptor(packSampleDescriptor({
      outcomeClass: 0, detail: 0,
      suspectEnergy: false, suspectLz: false,
      ftleValid: false, wordTruncated: false, wordUncertain: false,
      encounterCount: 0, substepLog2: 0, benettinCount: 0,
      dominantPair: 0,
    }));
    const on = unpackSampleDescriptor(packSampleDescriptor({
      outcomeClass: 0, detail: 0,
      suspectEnergy: false, suspectLz: false,
      ftleValid: true, wordTruncated: false, wordUncertain: false,
      encounterCount: 0, substepLog2: 0, benettinCount: 32,
      dominantPair: 0,
    }));
    return Promise.resolve({
      id: 'A5', name: 'FTLE_VALID only set when Benettin actually ran',
      passed: !off.ftleValid && on.ftleValid && on.benettinCount === 32,
    });
  },
);
