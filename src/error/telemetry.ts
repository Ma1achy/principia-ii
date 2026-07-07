export enum Level {
  Debug = 10,
  Info = 20,
  Warn = 30,
  Error = 40,
}

export interface TelemetryRecord {
  level: Level;
  /** Epoch milliseconds (injectable clock for deterministic tests). */
  ts: number;
  message: string;
  /** Structured, JSON-serialisable context. Never contains a raw Error. */
  context: Readonly<Record<string, unknown>>;
}

/** Pluggable destination. Implement this to forward to a real service. */
export interface TelemetrySink {
  emit(record: TelemetryRecord): void;
}

/** Default sink: discards everything (a build with no observability
 *  stack is silent and zero-cost). */
export class NoopSink implements TelemetrySink {
  emit(_record: TelemetryRecord): void { /* intentionally empty */ }
}

/** Buffers records in memory (diagnostics panel, tests). */
export class InMemorySink implements TelemetrySink {
  private buf: TelemetryRecord[] = [];
  constructor(private readonly cap = 1000) {}

  emit(record: TelemetryRecord): void {
    this.buf.push(record);
    if (this.buf.length > this.cap) this.buf.shift();
  }

  records(): readonly TelemetryRecord[] { return this.buf; }
  /** Records at exactly `level`. */
  at(level: Level): readonly TelemetryRecord[] {
    return this.buf.filter(r => r.level === level);
  }
  clear(): void { this.buf = []; }
}

export interface TelemetryOptions {
  /** Minimum level emitted; records below this are dropped before build. */
  minLevel?: Level;
  sink?: TelemetrySink;
  /** Injectable clock (defaults to Date.now). */
  now?: () => number;
  /** Context merged into every record (e.g. { tier, sessionId }). */
  base?: Record<string, unknown>;
}

export class Telemetry {
  private readonly minLevel: Level;
  private readonly sink: TelemetrySink;
  private readonly now: () => number;
  private readonly base: Readonly<Record<string, unknown>>;

  constructor(opts: TelemetryOptions = {}) {
    this.minLevel = opts.minLevel ?? Level.Info;
    this.sink = opts.sink ?? new NoopSink();
    this.now = opts.now ?? (() => Date.now());
    this.base = opts.base ?? {};
  }

  /** Core entry. Returns false if filtered out (useful in tests). */
  log(level: Level, message: string, context: Record<string, unknown> = {}): boolean {
    if (level < this.minLevel) return false;
    this.sink.emit({
      level,
      ts: this.now(),
      message,
      context: { ...this.base, ...context },
    });
    return true;
  }

  debug(message: string, context?: Record<string, unknown>): boolean {
    return this.log(Level.Debug, message, context ?? {});
  }
  info(message: string, context?: Record<string, unknown>): boolean {
    return this.log(Level.Info, message, context ?? {});
  }
  warn(message: string, context?: Record<string, unknown>): boolean {
    return this.log(Level.Warn, message, context ?? {});
  }
  error(message: string, context?: Record<string, unknown>): boolean {
    return this.log(Level.Error, message, context ?? {});
  }

  /** Derive a child with extra base context (same sink, same threshold). */
  child(extra: Record<string, unknown>): Telemetry {
    return new Telemetry({
      minLevel: this.minLevel,
      sink: this.sink,
      now: this.now,
      base: { ...this.base, ...extra },
    });
  }
}
