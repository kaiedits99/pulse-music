// Stopping politely. A host asks an app to stop with SIGTERM and gives it a short while before forcing it.
//
// The server stops taking new requests, lets the ones in flight finish, then exits. When Litestream is
// copying the database to a bucket there is one more step: Litestream copies on a timer (and does not
// make a last copy of its own on shutdown), so the server waits a little longer than one copy interval
// before exiting, which lets the last changes go out. The start script sets that wait through
// PULSE_SHUTDOWN_DELAY_SECONDS; it is zero otherwise.

const MAX_DELAY_SECONDS = 25; // hosts typically allow about 30 seconds before they force a stop

export function shutdownDelayMs(value) {
  const seconds = Number(value);
  return Math.min(MAX_DELAY_SECONDS, Math.max(0, Number.isFinite(seconds) ? seconds : 0)) * 1000;
}

export function installGracefulShutdown(server, { delaySeconds = 0, log = console, exit = (code) => process.exit(code) } = {}) {
  const delayMs = shutdownDelayMs(delaySeconds);
  let stopping = false;

  function stop(signal) {
    if (stopping) return;
    stopping = true;
    log.log(`[pulse] ${signal} received, shutting down`
      + (delayMs ? ` (staying up ${delayMs / 1000}s more so the latest database changes are copied first).` : '.'));
    const closed = new Promise((resolve) => server.close(resolve)); // no new requests; in-flight ones finish
    server.closeIdleConnections?.();
    const waited = new Promise((resolve) => setTimeout(resolve, delayMs));
    Promise.all([closed, waited]).then(() => exit(0));
    // Never hang because a connection will not end (a long download, for example).
    setTimeout(() => exit(0), delayMs + 5000).unref();
  }

  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  return stop;
}
