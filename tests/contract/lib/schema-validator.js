'use strict';

/**
 * A tiny JSON-Schema-subset validator + fixture generator, driven by the schema
 * objects produced by `openapi-extract.js`.
 *
 * Supports exactly what `docs/openapi.yaml` uses: `type: object` with `required`
 * and `properties`, property types `string` / `integer` / `boolean` / `array`,
 * `format: byte` (base64 string), `enum`, and `$ref` to another object schema.
 * This is intentionally not a general-purpose validator.
 */

/** @returns {(body: any) => { ok: boolean, errors: string[] }} */
function buildValidator(schema, allSchemas) {
  return function validate(body) {
    const errors = [];
    checkObject(schema, body, '', errors, allSchemas);
    return { ok: errors.length === 0, errors };
  };
}

function checkObject(schema, value, prefix, errors, allSchemas) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${prefix || '<root>'}: expected an object`);
    return;
  }
  for (const req of schema.required || []) {
    if (!(req in value)) errors.push(`${prefix}${req}: missing required field`);
  }
  for (const [key, spec] of Object.entries(schema.properties || {})) {
    if (!(key in value)) continue; // presence handled above
    checkValue(spec, value[key], `${prefix}${key}`, errors, allSchemas);
  }
}

function checkValue(spec, value, label, errors, allSchemas) {
  if (spec.ref) {
    const target = allSchemas[spec.ref];
    if (!target) {
      errors.push(`${label}: unresolved $ref ${spec.ref}`);
      return;
    }
    if (spec.type === 'array') {
      if (!Array.isArray(value)) errors.push(`${label}: expected an array`);
      else value.forEach((item, i) => checkObject(target, item, `${label}[${i}].`, errors, allSchemas));
    } else {
      checkObject(target, value, `${label}.`, errors, allSchemas);
    }
    return;
  }

  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string') errors.push(`${label}: expected a string`);
      else if (spec.enum && !spec.enum.includes(value))
        errors.push(`${label}: '${value}' is not one of [${spec.enum.join(', ')}]`);
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.floor(value) !== value)
        errors.push(`${label}: expected an integer`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${label}: expected a boolean`);
      break;
    case 'array':
      if (!Array.isArray(value)) errors.push(`${label}: expected an array`);
      break;
    default:
      // unknown / unconstrained — accept
      break;
  }
}

/** Build a minimal spec-conforming body for a request schema. */
function conformingBody(schema, allSchemas) {
  const body = {};
  const need = new Set(schema.required || []);
  // Always include required fields; also include any other simple properties so
  // the "wrong-typed field" test has something to poke at.
  for (const [key, spec] of Object.entries(schema.properties || {})) {
    if (need.has(key) || !spec.ref) {
      body[key] = sampleValue(spec, allSchemas);
    }
  }
  for (const key of need) {
    if (!(key in body)) body[key] = sampleValue(schema.properties[key] || { type: 'string' }, allSchemas);
  }
  return body;
}

function sampleValue(spec, allSchemas) {
  if (spec.ref) {
    const target = allSchemas[spec.ref];
    const obj = target ? conformingBody(target, allSchemas) : {};
    return spec.type === 'array' ? [obj] : obj;
  }
  switch (spec.type) {
    case 'integer':
      return 1000;
    case 'boolean':
      return true;
    case 'array':
      return ['x'];
    case 'string':
    default:
      if (spec.enum) return spec.enum[0];
      if (spec.format === 'byte') return Buffer.from('sample').toString('base64');
      return 'sample';
  }
}

module.exports = { buildValidator, conformingBody };
