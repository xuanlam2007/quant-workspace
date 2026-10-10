const assert = require('node:assert/strict');
const test = require('node:test');
const braces = require('./index');

test('nested braces, parentheses and unclosed groups fail before recursive walking', () => {
  for (const [open, close] of [['{', '}'], ['(', ')']]) {
    for (const pattern of [open.repeat(200) + 'a' + close.repeat(200), open.repeat(200) + 'a']) {
      assert.throws(() => braces.parse(pattern), { name: 'SyntaxError', message: /depth limit/ });
    }
  }
});

test('oversized input is rejected by the length guard before parsing', () => {
  assert.throws(() => braces.parse('{'.repeat(10000) + 'a' + '}'.repeat(10000)), {
    name: 'SyntaxError', message: /exceeds max characters/
  });
});

test('caller supplied deep and cyclic ASTs are bounded for every walker', () => {
  let node = { type: 'text', value: 'a' };
  for (let i = 0; i < 200; i++) node = { type: 'root', nodes: [node] };
  const cycle = { type: 'root', nodes: [] };
  cycle.nodes.push(cycle);
  for (const ast of [node, cycle]) {
    for (const walk of [braces.compile, braces.expand, braces.stringify]) {
      assert.throws(() => walk(ast), { name: 'SyntaxError', message: /depth limit/ });
    }
  }
});

test('ordinary glob alternatives, nested patterns, ranges and escaped braces still work', () => {
  assert.deepEqual(braces.expand('src/{app,lib}/**/*.{ts,tsx}'), ['src/app/**/*.ts', 'src/app/**/*.tsx', 'src/lib/**/*.ts', 'src/lib/**/*.tsx']);
  assert.deepEqual(braces.expand('a{b,{c,d}}'), ['ab', 'ac', 'ad']);
  assert.deepEqual(braces.expand('x{1..3}'), ['x1', 'x2', 'x3']);
  assert.equal(braces.compile('x{a,b}'), 'x(a|b)');
  assert.deepEqual(braces.expand('x\\{a,b\\}'), ['x{a,b}']);
});
