import assert from 'node:assert/strict';
import test from 'node:test';
import {enableLocalPriority} from '../local-priority.js';

test('enables only an unchecked city-priority checkbox', () => {
  const checkbox = {
    checked: false,
    matches: selector => selector === 'input',
    getAttribute: () => null,
    click() { this.checked = true; },
  };
  const label = {
    textContent: 'Сначала из выбранного города',
    matches: () => false,
    control: checkbox,
  };
  const previousDocument = globalThis.document;
  globalThis.document = {querySelectorAll: () => [label]};
  try {
    assert.equal(enableLocalPriority(), 'enabled');
    assert.equal(checkbox.checked, true);
    assert.equal(enableLocalPriority(), 'already-enabled');
    assert.equal(checkbox.checked, true);
    label.textContent = 'Только с фото';
    assert.equal(enableLocalPriority(), 'not-found');
  } finally {
    globalThis.document = previousDocument;
  }
});
