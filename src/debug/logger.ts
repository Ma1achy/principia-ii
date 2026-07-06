/**
 * Minimal levelled logger. Pluggable sink + an in-memory ring so the dev page
 * (and tests) can read back what was logged. This is deliberately tiny: G11
 * Telemetry later subsumes it behind the same `LogSink` seam — keep the sink
 * signature stable so G11 can swap the sink without touching call sites.
 */

export enum LogLevel {
  Debug = 10,
  Info = 20,
  Warn = 30,
  Error = 40,
}

export interface LogRecord {
  level: LogLevel;
  msg: string;
  ts: number;            // ms epoch (injectable for tests)
  data?: unknown;
}

/** The seam G11 Telemetry replaces. A sink receives every record at/above the
 *  logger's threshold. */
export type LogSink = (rec: LogRecord) => void;

export interface LoggerOpts {
  level?: LogLevel;
  sink?: LogSink;
  ringSize?: number;     // 0 disables the ring
  now?: () => number;
}

export class Logger {
  private level: LogLevel;
  private sink: LogSink;
  private ring: LogRecord[] = [];
  private ringSize: number;
  private now: () => number;

  constructor(opts: LoggerOpts = {}) {
    this.level = opts.level ?? LogLevel.Info;
    this.sink = opts.sink ?? ((): void => {});
    this.ringSize = opts.ringSize ?? 256;
    this.now = opts.now ?? ((): number => Date.now());
  }

  setLevel(level: LogLevel): void { this.level = level; }

  private emit(level: LogLevel, msg: string, data?: unknown): void {
    if (level < this.level) return;
    const rec: LogRecord = { level, msg, ts: this.now() };
    if (data !== undefined) rec.data = data;        // exactOptionalPropertyTypes
    if (this.ringSize > 0) {
      this.ring.push(rec);
      if (this.ring.length > this.ringSize) this.ring.shift();
    }
    this.sink(rec);
  }

  debug(msg: string, data?: unknown): void { this.emit(LogLevel.Debug, msg, data); }
  info(msg: string, data?: unknown): void  { this.emit(LogLevel.Info, msg, data); }
  warn(msg: string, data?: unknown): void  { this.emit(LogLevel.Warn, msg, data); }
  error(msg: string, data?: unknown): void { this.emit(LogLevel.Error, msg, data); }

  /** Snapshot the ring (most recent last). */
  records(): readonly LogRecord[] { return [...this.ring]; }
  clear(): void { this.ring = []; }
}

/** A console sink for the dev page. */
export const consoleSink: LogSink = (rec) => {
  const tag = LogLevel[rec.level] ?? String(rec.level);
  const line = `[${tag}] ${rec.msg}`;
  if (rec.level >= LogLevel.Error) console.error(line, rec.data ?? '');
  else if (rec.level >= LogLevel.Warn) console.warn(line, rec.data ?? '');
  else console.log(line, rec.data ?? '');
};
