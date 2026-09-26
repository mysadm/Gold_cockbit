// Minimal JSON Schema subset interpreter, test-only. It exists so
// analyst-output-schema-agreement.test.mjs can check the hand-rolled validator
// (shared/analystOutputV4.mjs) against the actual .schema.json files without adding a
// schema-validator dependency to the app. Supports exactly the keywords those two
// (deliberately flat, self-contained — see their $comment) schema files use: type, enum,
// properties/required/additionalProperties, items, minItems/maxItems, minLength/maxLength,
// pattern, minimum/maximum.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function matchesSchema(value, schema) {
  if (schema.type === 'object') {
    if (!isObj(value)) return false;
    for (const key of schema.required || []) if (!(key in value)) return false;
    for (const [key, subschema] of Object.entries(schema.properties || {})) {
      if (key in value && !matchesSchema(value[key], subschema)) return false;
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      if (Object.keys(value).some((k) => !allowed.has(k))) return false;
    }
    return true;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) return false;
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return false;
    if (schema.items && !value.every((item) => matchesSchema(item, schema.items))) return false;
    return true;
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') return false;
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
    if (schema.enum && !schema.enum.includes(value)) return false;
    return true;
  }

  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
    return true;
  }

  return true;
}
