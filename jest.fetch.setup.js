// Polyfill fetch for Jest environment
global.fetch = require('whatwg-fetch');
