import { createLogger, type LogEntry } from './logger';

describe('createLogger', () => {
  it('emits structured entries with bindings, child bindings and serialised errors', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ sink: (e) => entries.push(e), bindings: { sessionId: 's1' } });

    logger
      .child({ correlationId: 'c1' })
      .error('http.error', { err: new Error('boom'), status: 500 });

    expect(entries).toEqual([
      {
        ts: expect.any(String),
        level: 'error',
        event: 'http.error',
        sessionId: 's1',
        correlationId: 'c1',
        err: { name: 'Error', message: 'boom' },
        status: 500,
      },
    ]);
  });

  it('drops entries below the minimum level and everything when silent', () => {
    const entries: LogEntry[] = [];
    const sink = (e: LogEntry) => entries.push(e);
    const info = createLogger({ sink, minLevel: 'info' });
    info.debug('ignored');
    info.info('kept');
    info.warn('kept');
    createLogger({ sink, minLevel: 'silent' }).error('ignored');
    expect(entries.map((e) => e.event)).toEqual(['kept', 'kept']);
  });
});
