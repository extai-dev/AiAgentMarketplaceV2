// Polyfill fetch before other imports
global.fetch = require('whatwg-fetch').fetch;

// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'
