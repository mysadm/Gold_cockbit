// HOST is unset by default so `.listen()` binds all interfaces exactly as it does on the
// live instance today; only a dev run that sets HOST opts into a specific bind address.
export function listenArgs(port, host = process.env.HOST) {
  return host ? [port, host] : [port];
}
