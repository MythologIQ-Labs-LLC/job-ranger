// Independent draft-contract probe. No production importer is invoked.
// This deliberately implements ONLY the JSON Schema keywords used by the draft
// operation-batch schema. It is not a general JSON Schema validator or an
// authority/reconciliation test; semantic cases are explicitly pending.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const fixture = read('docs/design/examples/jr-agent-60-day-batch.synthetic.json');
const schema = read('docs/design/schemas/jr-agent-operation-batch-v1.schema.json');
const corpus = read('tests/fixtures/agent-workspace/governance-vectors.v1.json');

const clone = (value) => structuredClone(value);
function mutate(source, item) {
  const target = clone(source);
  if (item.op === 'raw_duplicate_format_key') {
    const json = JSON.stringify(target);
    const marker = '"format":"jr-agent-operation-batch"';
    assert.equal(json.split(marker).length, 2);
    return json.replace(marker, marker + ',' + marker);
  }
  const keys = item.path.split('/').slice(1).map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'));
  assert.ok(keys.length > 0, 'a mutation must address a specific field');
  let parent = target;
  for (const key of keys.slice(0, -1)) {
    assert.ok(parent !== null && Object.hasOwn(parent, key), 'mutation path not found: ' + item.path);
    parent = parent[key];
  }
  const key = keys.at(-1);
  if (item.op === 'remove') {
    assert.ok(Object.hasOwn(parent, key), 'remove path missing');
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  } else if (item.op === 'replace' || item.op === 'add' || item.op === 'replace_repeat') {
    if (item.op !== 'add') assert.ok(Object.hasOwn(parent, key), 'replace path missing');
    parent[key] = item.op === 'replace_repeat' ? item.value.repeat(item.count) : item.value;
  } else {
    assert.fail('unsupported corpus mutation: ' + item.op);
  }
  return target;
}
function validateSubset(node, value, path = '$') {
  const errors = [];
  if (Object.hasOwn(node, 'const') && JSON.stringify(node.const) !== JSON.stringify(value)) {
    errors.push(path + ': const');
  }
  if (node.enum && !node.enum.includes(value)) errors.push(path + ': enum');
  if (node.oneOf) {
    const count = node.oneOf.filter(choice => validateSubset(choice, value, path).length === 0).length;
    if (count !== 1) errors.push(path + ': oneOf(' + count + ')');
  }
  if (node.type) {
    const valid = node.type === 'null' ? value === null
      : node.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : node.type === 'array' ? Array.isArray(value)
      : node.type === 'integer' ? Number.isSafeInteger(value)
      : typeof value === node.type;
    if (!valid) return [...errors, path + ': type ' + node.type];
  }
  if (node.type === 'string') {
    if (node.minLength !== undefined && value.length < node.minLength) errors.push(path + ': minLength');
    if (node.maxLength !== undefined && value.length > node.maxLength) errors.push(path + ': maxLength');
    if (node.pattern && !new RegExp(node.pattern, 'u').test(value)) errors.push(path + ': pattern');
  }
  if (node.type === 'integer') {
    if (node.minimum !== undefined && value < node.minimum) errors.push(path + ': minimum');
    if (node.maximum !== undefined && value > node.maximum) errors.push(path + ': maximum');
  }
  if (node.type === 'object') {
    for (const name of node.required || []) {
      if (!Object.hasOwn(value, name)) errors.push(path + '.' + name + ': required');
    }
    if (node.additionalProperties === false) {
      for (const name of Object.keys(value)) {
        if (!Object.hasOwn(node.properties || {}, name)) errors.push(path + '.' + name + ': unknown');
      }
    }
    for (const [name, child] of Object.entries(node.properties || {})) {
      if (Object.hasOwn(value, name)) errors.push(...validateSubset(child, value[name], path + '.' + name));
    }
  }
  if (node.type === 'array') {
    if (node.minItems !== undefined && value.length < node.minItems) errors.push(path + ': minItems');
    if (node.maxItems !== undefined && value.length > node.maxItems) errors.push(path + ': maxItems');
    if (node.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) {
      errors.push(path + ': uniqueItems');
    }
    value.forEach((item, i) => errors.push(...validateSubset(node.items, item, path + '[' + i + ']')));
  }
  return errors;
}

test('draft source schema and sample remain structurally compatible', () => {
  assert.equal(schema.properties.format.const, 'jr-agent-operation-batch');
  assert.equal(schema.properties.schema_version.const, 1);
  assert.equal(corpus.schema_version, 1);
  assert.equal(corpus.cases.length >= 20, true);
  assert.equal(validateSubset(schema, fixture).length, 0);
});

test('adversarial corpus has unique IDs and explicit expected reconciliation behavior', () => {
  const ids = new Set();
  for (const item of corpus.cases) {
    assert.ok(!ids.has(item.id), 'duplicate case: ' + item.id);
    ids.add(item.id);
    assert.ok(['syntax','schema','semantic'].includes(item.layer));
    assert.ok(['accept','reject'].includes(item.expect_structure));
    assert.ok(item.expect_reconcile.length > 0);
    assert.ok(item.reason.length > 10);
  }
  assert.ok(corpus.scenarios.some(item => item.id === 'two-month-offline-return'));
  assert.ok(corpus.scenarios.some(item => item.id === 'two-agent-conflicting-note'));
});

for (const item of corpus.cases) {
  test('draft schema structural probe: ' + item.id, () => {
    let candidate = clone(fixture);
    for (const change of item.mutations) candidate = mutate(candidate, change);
    if (item.layer === 'syntax') {
      assert.equal(typeof candidate, 'string');
      assert.match(candidate, /"format":"jr-agent-operation-batch","format":"jr-agent-operation-batch"/);
      // JSON.parse accepts duplicates. The production parser MUST NOT.
      assert.doesNotThrow(() => JSON.parse(candidate));
      return;
    }
    const errors = validateSubset(schema, candidate);
    assert.equal(errors.length === 0, item.expect_structure === 'accept',
      item.id + ': unexpected structural verdict: ' + errors.join('; '));
    // Cases marked semantic may be well-formed but cannot be authorized
    // without receipt, historical revision, idempotency and capability checks.
    if (item.layer === 'semantic') assert.equal(item.expect_structure, 'accept');
  });
}
