const { z } = require('zod');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Treats "" and null as "not provided" for optional form fields.
const optional = (schema) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

module.exports = { httpError, optional };
