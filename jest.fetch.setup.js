// Polyfill fetch for Jest environments that don't have it natively.
// In Node 18+ / jsdom with native fetch, skip the polyfill so we
// don't accidentally clobber globalThis.fetch with the module object.
if (typeof globalThis.fetch !== 'function') {
  const { fetch, Headers, Request, Response } = require('whatwg-fetch');
  global.fetch    = fetch;
  global.Headers  = Headers;
  global.Request  = Request;
  global.Response = Response;
}
