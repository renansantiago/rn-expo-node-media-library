import { newId } from './ids';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

export interface LogEntry extends Fields {
  ts: string;
  level: LogLevel;
  event: string;
}

export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  child(bindings: Fields): Logger;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** One JSON object per line, so logs stay machine-parseable in Metro, Logcat and Console.app. */
export const consoleSink: LogSink = (entry) => {
  const line = JSON.stringify(entry);
  if (entry.level === 'error') console.error(line);
  else if (entry.level === 'warn') console.warn(line);
  else console.log(line);
};

function serialize(fields: Fields): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? { name: value.name, message: value.message } : value;
  }
  return out;
}

export interface LoggerOptions {
  sink?: LogSink;
  minLevel?: LogLevel | 'silent';
  bindings?: Fields;
}

export function createLogger({
  sink = consoleSink,
  minLevel = 'info',
  bindings = {},
}: LoggerOptions = {}): Logger {
  const log =
    (level: LogLevel) =>
    (event: string, fields: Fields = {}) => {
      if (minLevel === 'silent' || LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
      sink({ ts: new Date().toISOString(), level, event, ...bindings, ...serialize(fields) });
    };
  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child: (extra) => createLogger({ sink, minLevel, bindings: { ...bindings, ...extra } }),
  };
}

/** Identifies one app launch; on every log line and shown in Account → Diagnostics for support. */
export const SESSION_ID = newId();

/** App-wide logger; `sessionId` ties together every log line from one app launch. */
export const logger = createLogger({
  minLevel: process.env.NODE_ENV === 'test' ? 'silent' : __DEV__ ? 'debug' : 'info',
  bindings: { sessionId: SESSION_ID },
});
