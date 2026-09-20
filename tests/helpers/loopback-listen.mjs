// Stops supertest requests from landing on other processes' servers (HTTP only).
//
// supertest starts each app with `app.listen(0)` (wildcard `::`) and then
// connects to http://127.0.0.1:<port>. On macOS the kernel lets that wildcard
// listener share an ephemeral port that another process already holds on
// 127.0.0.1 (Node sets SO_REUSEADDR), and the connection to 127.0.0.1:<port>
// then reaches THAT process instead of the test app. Whatever else runs on the
// dev machine (Ollama, VS Code, Tailscale, a dev server...) can answer a test
// request with a stray 404 / 401 / HTML page, or accept it and never reply
// (a 15s test timeout). It happens about 3 times in 10,000 requests.
//
// Binding the test server to 127.0.0.1 explicitly makes the kernel refuse a
// port already held there. Node resolves an explicit host asynchronously, so
// the server is not listening yet when supertest builds the URL; we start it
// in serverAddress() and fill in the real port when the request is sent.
import supertest from 'supertest';

const { Test } = supertest;
if (typeof Test?.prototype.serverAddress !== 'function' || typeof Test.prototype.end !== 'function') {
  throw new Error('supertest internals changed: update tests/helpers/loopback-listen.mjs');
}
const serverAddress = Test.prototype.serverAddress;
const end = Test.prototype.end;

Test.prototype.serverAddress = function loopbackServerAddress(app, path) {
  if (app.address()) return serverAddress.call(this, app, path);
  this._server = app; // supertest closes it after the response, as before
  this._loopbackPath = path;
  this._loopbackListening = new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', () => {
      app.removeListener('error', reject); // a reused http.Server would otherwise pile these up
      resolve();
    });
  });
  this._loopbackListening.catch(() => {}); // surfaced by end() below
  return `http://127.0.0.1:0${path}`;
};

Test.prototype.end = function loopbackEnd(fn) {
  if (!this._loopbackListening) return end.call(this, fn);
  this._loopbackListening.then(
    () => {
      this.url = `http://127.0.0.1:${this._server.address().port}${this._loopbackPath}`;
      end.call(this, fn);
    },
    (err) => (typeof fn === 'function' ? fn(err) : undefined)
  );
  return this;
};
