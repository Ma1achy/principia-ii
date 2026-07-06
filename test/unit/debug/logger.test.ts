import { describe, it, expect } from 'vitest';
import { Logger, LogLevel, type LogRecord } from '@/debug/logger.js';

describe('Logger', () => {
  it('gates below the threshold', () => {
    const seen: LogRecord[] = [];
    const log = new Logger({ level: LogLevel.Warn, sink: (r) => seen.push(r) });
    log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
    expect(seen.map((r) => r.msg)).toEqual(['w', 'e']);
  });

  it('captures into a bounded ring and clears', () => {
    const log = new Logger({ level: LogLevel.Debug, ringSize: 2, now: () => 42 });
    log.info('a'); log.info('b'); log.info('c');
    expect(log.records().map((r) => r.msg)).toEqual(['b', 'c']);
    expect(log.records()[0]!.ts).toBe(42);
    log.clear();
    expect(log.records()).toEqual([]);
  });

  it('passes structured data through to the sink', () => {
    const seen: LogRecord[] = [];
    const log = new Logger({ level: LogLevel.Debug, sink: (r) => seen.push(r) });
    log.info('with data', { sample: 7 });
    expect(seen[0]!.data).toEqual({ sample: 7 });
  });

  it('setLevel changes gating at runtime', () => {
    const seen: LogRecord[] = [];
    const log = new Logger({ level: LogLevel.Error, sink: (r) => seen.push(r) });
    log.warn('hidden');
    log.setLevel(LogLevel.Debug);
    log.warn('shown');
    expect(seen.map((r) => r.msg)).toEqual(['shown']);
  });
});
