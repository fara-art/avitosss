import assert from 'node:assert/strict';
import test from 'node:test';
import {enableLocalPriority,scrollListing} from '../local-priority.js';

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

test('listing scroll reaches the bottom before cards are read', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const card = {
    textContent: 'Электросамокат Kugoo 30 000 ₽',
    querySelectorAll: () => [{href: 'https://www.avito.ru/sankt-peterburg/transport/kugoo_1234567', textContent: 'Kugoo'}],
    querySelector: selector => selector.includes('item-title') ? {textContent: 'Электросамокат Kugoo'} : selector.includes('item-price') ? {textContent: '30 000 ₽'} : null,
  };
  globalThis.document = {documentElement: {scrollHeight: 1000},querySelectorAll: () => [card]};
  globalThis.window = {
    innerHeight: 800,
    scrollY: 0,
    scrollBy(_x, distance) { this.scrollY = Math.min(200, this.scrollY + distance); },
  };
  try {
    const result = await scrollListing();
    assert.equal(result.position, 200);
    assert.equal(result.height, 1000);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].price, 30000);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
