import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSearchUrl,
  citySlug,
  isSafeAvitoUrl,
  matchesSearchCity,
  matchesSearchQuery,
  isAccessoryForQuery,
  matchesPriceRange,
  localAnalyze,
  mergeVerdicts,
  parsePrice,
  parseRequirements,
  upsertResult,
  shouldInspectCandidate,
} from '../core.js';

test('city names are mapped and transliterated for Avito paths', () => {
  assert.equal(citySlug('СПб'), 'sankt-peterburg');
  assert.equal(citySlug('Нижний Новгород'), 'nizhniy_novgorod');
  assert.equal(citySlug('Тула'), 'tula');
});

test('search URL uses Avito pagination and maximum price parameters', () => {
  const url = new URL(buildSearchUrl({query: 'iPhone 15', city: 'Москва', page: 3, minPrice: 20000, maxPrice: 45000}));
  assert.equal(url.pathname, '/moskva');
  assert.equal(url.searchParams.get('q'), 'iPhone 15');
  assert.equal(url.searchParams.get('p'), '3');
  assert.equal(url.searchParams.get('pmax'), '45000');
  assert.equal(url.searchParams.get('pmin'), '20000');
  assert.equal(url.searchParams.has('priceMax'), false);
});

test('query relevance excludes a charger and a different model', () => {
  assert.equal(matchesSearchQuery({title: 'Зарядка самоката Kugoo M5, Kugoo X1, Kugoo M3'}, 'Kug F3 плюс'), false);
  assert.equal(matchesSearchQuery({title: 'Электросамокат Kugoo F3 Plus'}, 'Kug F3 плюс'), true);
  assert.equal(matchesSearchQuery({title: 'Зарядка для iPhone 15'}, 'iPhone 15'), false);
  assert.equal(matchesSearchQuery({title: 'Зарядка для iPhone 15'}, 'зарядка iPhone 15'), true);
  assert.equal(matchesSearchQuery({title: 'iPhone 14 Pro'}, 'iPhone 15 Pro'), false);
});

test('accessory filter does not reject ordinary listings from a broad Avito query', () => {
  assert.equal(isAccessoryForQuery({title: 'Электросамокат Kugoo G3 Plus'}, 'Kug F3 плюс'), false);
  assert.equal(isAccessoryForQuery({title: 'Зарядка для Kugoo G3 Plus'}, 'Kug F3 плюс'), true);
  assert.equal(isAccessoryForQuery({title: 'Зарядка для Kugoo G3 Plus'}, 'Зарядка Kugoo'), false);
});

test('price range rejects cheap, expensive and unreadable prices', () => {
  assert.equal(matchesPriceRange(1490, 20000, 45000), false);
  assert.equal(matchesPriceRange(30000, 20000, 45000), true);
  assert.equal(matchesPriceRange(50000, 20000, 45000), false);
  assert.equal(matchesPriceRange(0, 20000, 45000), false);
});

test('rechecking replaces a result without changing other results', () => {
  const original = [{url: 'https://www.avito.ru/moskva/a_1234567', score: 60}, {url: 'https://www.avito.ru/moskva/b_1234567', score: 70}];
  const updated = upsertResult(original, {url: original[0].url, score: 90});
  assert.equal(updated.length, 2);
  assert.equal(updated[0].score, 90);
  assert.equal(updated[1].score, 70);
});

test('duplicates are skipped in one run, then can be checked in the next run', () => {
  const url = 'https://www.avito.ru/moskva/a_1234567';
  const prior = new Set([url]);
  const currentRun = new Set();
  assert.equal(shouldInspectCandidate(url, currentRun, prior, true), true);
  currentRun.add(url);
  assert.equal(shouldInspectCandidate(url, currentRun, prior, true), false);
  assert.equal(shouldInspectCandidate(url, new Set(), prior, true), true);
  assert.equal(shouldInspectCandidate(url, new Set(), prior, false), false);
});

test('only HTTPS Avito links are accepted', () => {
  assert.equal(isSafeAvitoUrl('https://www.avito.ru/moskva/item_123'), true);
  assert.equal(isSafeAvitoUrl('https://m.avito.ru/item_123'), true);
  assert.equal(isSafeAvitoUrl('https://avito.ru.evil.example/item'), false);
  assert.equal(isSafeAvitoUrl('javascript:alert(1)'), false);
});

test('Saint Petersburg search excludes nearby cities and keeps districts', () => {
  assert.equal(matchesSearchCity({url: 'https://www.avito.ru/sankt-peterburg/telefony/iphone_1234567', location: 'Санкт-Петербург, Центральный район'}, 'Санкт-Петербург'), true);
  assert.equal(matchesSearchCity({url: 'https://www.avito.ru/sankt-peterburg/telefony/iphone_1234567', location: 'м. Петроградская'}, 'СПб'), true);
  assert.equal(matchesSearchCity({url: 'https://www.avito.ru/vsevolozhsk/telefony/iphone_1234567', location: 'Всеволожск'}, 'Санкт-Петербург'), false);
  assert.equal(matchesSearchCity({url: 'https://www.avito.ru/moskva/telefony/iphone_1234567', location: 'Москва'}, 'Санкт-Петербург'), false);
  assert.equal(matchesSearchCity({url: 'https://www.avito.ru/sankt-peterburg/telefony/iphone_1234567', location: 'Москва'}, 'Санкт-Петербург'), false);
  assert.equal(matchesSearchCity({url: 'https://www.avito.ru/moskva/telefony/iphone_1234567'}, 'Вся Россия'), true);
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
