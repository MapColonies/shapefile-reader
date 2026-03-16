type LogFn = (obj: Record<string, unknown>) => void;

export interface Logger {
  info: LogFn;
  debug: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
}
