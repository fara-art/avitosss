import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSearchUrl,
  citySlug,
  isSafeAvitoUrl,
  localAnalyze,
  mergeVerdicts,
  parsePrice,
  parseRequirements,
} from '../core.js';

test('city names are mapped and transliterated for Avito paths', () => {
  assert.equal(citySlug('СПб'), 'sankt-peterburg');
  assert.equal(citySlug('Нижний Новгород'), 'nizhniy_novgorod');
  assert.equal(citySlug('Тула'), 'tula');
});

test('search URL uses Avito pagination and maximum price parameters', () => {
  const url = new URL(buildSearchUrl({query: 'iPhone 15', city: 'Москва', page: 3, maxPrice: 45000}));
  assert.equal(url.pathname, '/moskva');
  assert.equal(url.searchParams.get('q'), 'iPhone 15');
  assert.equal(url.searchParams.get('p'), '3');
  assert.equal(url.searchParams.get('pmax'), '45000');
  assert.equal(url.searchParams.has('priceMax'), false);
});

test('only HTTPS Avito links are accepted', () => {
  assert.equal(isSafeAvitoUrl('https://www.avito.ru/moskva/item_123'), true);
  assert.equal(isSafeAvitoUrl('https://m.avito.ru/item_123'), true);
  assert.equal(isSafeAvitoUrl('https://avito.ru.evil.example/item'), false);
  assert.equal(isSafeAvitoUrl('javascript:alert(1)'), false);
});

test('requirements are parsed and unknown facts become questions', () => {
  const requirements = parseRequirements('Память 128 ГБ; Face ID\nАккумулятор 90%');
  const verdict = localAnalyze(
    {title: 'iPhone 15 128 ГБ', description: 'Face ID работает', specs: '', price: 60000},
    requirements,
    {maxPrice: 65000, condition: 'used'},
  );
  assert.deepEqual(verdict.matched, ['Face ID']);
  assert.deepEqual(verdict.missing, ['Память 128 ГБ', 'Аккумулятор 90%']);
  assert.ok(verdict.questions.some(question => /Аккумулятор 90%/.test(question)));
});

test('local risks survive AI result merging', () => {
  const local = localAnalyze({title: 'Телефон', description: 'Не включается', price: 1000}, [], {});
  const merged = mergeVerdicts(local, {matched: [], missing: [], risks: ['Нет фото'], questions: [], summary: 'Осторожно'});
  assert.deepEqual(merged.risks, ['В описании указан возможный дефект', 'Нет фото']);
  assert.equal(merged.summary, 'Осторожно');
});

test('price parser handles spaces and currency labels', () => {
  assert.equal(parsePrice('45 990 ₽'), 45990);
  assert.equal(parsePrice('Цена договорная'), 0);
});
