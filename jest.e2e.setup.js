/**
 * jest.e2e.setup.js
 * Loads .env variables before the E2E test suite runs.
 * jest.e2e.config.js references this file via `setupFiles`.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
