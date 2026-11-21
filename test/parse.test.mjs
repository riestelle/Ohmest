import test from 'node:test';
import assert from 'node:assert/strict';

import { pf, fixF, evalF } from '../lib/calc.js';

test('pf: plain numbers and notation', () => {
  for (const [s, n] of [['3.5', 3.5], ['-3.5', -3.5], ['.5', 0.5], ['3e8', 3e8], ['3x10^8', 3e8], ['3 x 10^8', 3e8], ['−4,2', -4.2]]) assert.equal(pf(s), n, s);
});
test('pf: commas', () => {
  assert.equal(pf('1,500'), 1500);
  assert.equal(pf('1,000'), 1000);
  assert.equal(pf('12,345,678'), 12345678);
  assert.equal(pf('1,500.75'), 1500.75);
  assert.equal(pf('3,5'), 3.5);
  assert.equal(pf('0,25'), 0.25);
  assert.ok(Number.isNaN(pf('1,2,3')));
});
test('pf: units after the number are ignored', () => {
  assert.equal(pf('9.8 m/s'), 9.8);
  assert.equal(pf('9.8 m/s^2'), 9.8);
  assert.equal(pf('1/2 kg'), 0.5);
  assert.equal(pf('5 N'), 5);
  assert.equal(pf('2 min'), 2);
  assert.equal(pf('(1+2)*3 J'), 9);
});
test('pf: e is notation, not Euler\'s number', () => {
  assert.equal(pf('2e'), 2);
  assert.equal(pf('5 e'), 5);
  assert.ok(Number.isNaN(pf('e')));
});
test('pf: formulas and junk', () => {
  assert.ok(Math.abs(pf('2pi') - 2 * Math.PI) < 1e-12);
  assert.ok(Math.abs(pf('sqrt(2)') - Math.SQRT2) < 1e-12);
  for (const bad of ['', 'abc', '1/0', '2 5', '$5', 'x'.repeat(50)]) assert.ok(Number.isNaN(pf(bad)), JSON.stringify(bad));
});

test('evalF: operators, precedence, functions in degrees', () => {
  assert.equal(evalF('2+3*4', {}), 14);
  assert.equal(evalF('2^3^2', {}), 512);
  assert.equal(evalF('-2^2', {}), -4);
  assert.ok(Math.abs(evalF('sin(30)', {}) - 0.5) < 1e-12);
  assert.equal(evalF('m*a', { m: 2, a: 5 }), 10);
});
test('evalF: refuses anything that is not maths', () => {
  for (const bad of ['alert(1)', 'constructor', '1/0', '2+', '(1', 'process.exit()', '__proto__']) assert.throws(() => evalF(bad, {}), bad);
});
test('fixF: implicit multiplication and unicode', () => {
  assert.equal(evalF(fixF('2a', ['a']), { a: 4 }), 8);
  assert.equal(evalF(fixF('ma', ['m', 'a']), { m: 2, a: 3 }), 6);
  assert.equal(evalF(fixF('2(3+1)'), {}), 8);
  assert.equal(evalF(fixF('6÷3×2'), {}), 4);
  assert.equal(evalF(fixF('√16'), {}), 4);
  assert.equal(evalF(fixF('x = 4'.replace(/^x\s*=\s*/, '')), {}), 4);
});