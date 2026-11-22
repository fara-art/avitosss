const CITY_ALIASES = {
  'вся россия': 'rossiya',
  россия: 'rossiya',
  москва: 'moskva',
  'санкт-петербург': 'sankt-peterburg',
  петербург: 'sankt-peterburg',
  спб: 'sankt-peterburg',
  екатеринбург: 'ekaterinburg',
  новосибирск: 'novosibirsk',
  казань: 'kazan',
  'нижний новгород': 'nizhniy_novgorod',
  краснодар: 'krasnodar',
  сочи: 'sochi',
  самара: 'samara',
  омск: 'omsk',
  пермь: 'perm',
  уфа: 'ufa',
  челябинск: 'chelyabinsk',
  ростов: 'rostov-na-donu',
  'ростов-на-дону': 'rostov-na-donu',
};

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function normalizeText(value = '') {
  return String(value)
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

export function citySlug(value) {
  const city = normalizeText(value);
  if (CITY_ALIASES[city]) return CITY_ALIASES[city];
  return [...city]
    .map((char) => TRANSLIT[char] ?? (/\w/.test(char) ? char : char === ' ' || char === '-' ? '_' : ''))
    .join('')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'rossiya';
}

export function buildSearchUrl({ query, city, page = 1, minPrice = 0, maxPrice = 0 }) {
  const url = new URL(`https://www.avito.ru/${citySlug(city)}`);
  url.searchParams.set('q', String(query).trim());
  if (Number(page) > 1) url.searchParams.set('p', String(Math.floor(Number(page))));
  if (Number(minPrice) > 0) url.searchParams.set('pmin', String(Math.floor(Number(minPrice))));
  if (Number(maxPrice) > 0) url.searchParams.set('pmax', String(Math.floor(Number(maxPrice))));
  return url.href;
}

const ACCESSORIES = /(?:^|[^а-яa-z])(зарядк[а-я]*|зарядн[а-я]*|чехол|чехлы|кабель|провод[а-я]*|запчаст[а-я]*|креплени[а-я]*|держател[а-я]*|адаптер[а-я]*|блок питания|защитн[а-я]* стекл[а-я]*)(?=$|[^а-яa-z])/i;

export function matchesSearchQuery(item, query) {
  const canonical = value => normalizeText(value).replace(/(^|[^а-я])плюс(?=$|[^а-я])/g, '$1plus');
  const requested = canonical(query);
  const title = canonical(item.title);
  const words = requested.match(/[a-zа-я0-9]+/g)?.filter(word => word.length > 2 || /\d/.test(word)) || [];
  if (!words.length || !title) return false;
  const titleWords = title.match(/[a-zа-я0-9]+/g) || [];
  if (ACCESSORIES.test(title) && !ACCESSORIES.test(requested)) return false;
  return words.every(word => titleWords.some(candidate =>
    candidate === word || word.length >= 3 && !/\d/.test(word) && candidate.startsWith(word) && candidate.length - word.length <= 3
  ));
}

export function matchesPriceRange(price, minPrice = 0, maxPrice = 0) {
  if ((minPrice || maxPrice) && !price) return false;
  return (!minPrice || price >= minPrice) && (!maxPrice || price <= maxPrice);
}

export function upsertResult(results, item) {
  return [item, ...results.filter(previous => previous.url !== item.url)];
}

export function shouldInspectCandidate(url, seenThisRun, previousResults, repeatOnNextSearch) {
  return !seenThisRun.has(url) && (repeatOnNextSearch || !previousResults.has(url));
}

export function isSafeAvitoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'avito.ru' || url.hostname.endsWith('.avito.ru'));
  } catch {
    return false;
  }
}

export function matchesSearchCity(item, city) {
  const requested = citySlug(city);
  if (requested === 'rossiya') return true;
  let pathCity;
  try {
    const url = new URL(item.url);
    if (!isSafeAvitoUrl(url.href)) return false;
    pathCity = url.pathname.split('/').filter(Boolean)[0];
  } catch {
    return false;
  }
  // Every Avito listing has its location in the first URL segment.
  // Search pages may include ads from nearby cities, so check each listing.
  if (pathCity !== requested) return false;
  const location = normalizeText(item.location);
  if (!location) return true;
  const requestedName = normalizeText(city);
  const aliases = requested === 'sankt-peterburg'
    ? ['санкт-петербург', 'спб', 'петербург']
    : [requestedName];
  const firstPart = location.split(/[,;\n]/)[0].replace(/^(город|г\.)\s*/, '').trim();
  // Districts, metro stations and street addresses do not state a different city.
  const knownOtherCity = Object.keys(CITY_ALIASES)
    .filter(name => CITY_ALIASES[name] !== requested && CITY_ALIASES[name] !== 'rossiya')
    .some(name => firstPart === name || firstPart.startsWith(name + ' '));
  return !knownOtherCity || aliases.some(name => firstPart === name || firstPart.startsWith(name + ' '));
}

export function parseRequirements(value, limit = 20) {
  return String(value)
    .split(/[;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function importantWords(requirement) {
  return normalizeText(requirement)
    .replace(/[^a-zа-я0-9%+.-]/gi, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !['чтобы', 'есть', 'или', 'для', 'при', 'без', 'под', 'над'].includes(word));
}

export function localAnalyze(item, requirements, { maxPrice = 0, condition = 'any' } = {}) {
  const text = normalizeText([item.title, item.description, item.specs].filter(Boolean).join(' '));
  const matched = [];
  const missing = [];
  const contradicted = [];

  for (const requirement of requirements) {
    const words = importantWords(requirement);
    const confirmed = words.length > 0 && words.every((word) => text.includes(word));
    (confirmed ? matched : missing).push(requirement);
  }

  const risks = [];
  if (maxPrice && item.price && item.price > maxPrice) risks.push('Цена выше заданного лимита');
  if (!item.price) risks.push('Цена не прочитана');
  if (/не работает|разбит|не включается|на запчасти|после дтп|требует ремонта/.test(text)) {
    risks.push('В описании указан возможный дефект');
  }
  if (condition === 'new' && /\bб\s*\/\s*у\b|бывш|пользовал|с пробегом/.test(text)) {
    risks.push('Есть признаки использования');
  }

  const score = Math.max(0, Math.min(100, Math.round(82 + matched.length * 5 - missing.length * 9 - risks.length * 22)));
  return {
    score,
    matched,
    missing,
    contradicted,
    risks,
    summary: risks.length
      ? 'Проверьте отмеченные риски перед покупкой.'
      : missing.length
        ? 'Часть важных характеристик нужно уточнить у продавца.'
        : 'В объявлении найдены указанные характеристики.',
    questions: missing.map((requirement) => `Подскажите, пожалуйста: ${requirement}?`),
  };
}

export function mergeVerdicts(local, ai, requirements = []) {
  if (!ai) return local;
  const clean = (value) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  const confirmed = clean(ai.matched);
  const conflict = clean(ai.contradicted);
  const unknown = clean(ai.missing);
  const matched = requirements.filter((req) => confirmed.includes(req) && !conflict.includes(req));
  const contradicted = requirements.filter((req) => conflict.includes(req));
  const missing = requirements.filter((req) => !matched.includes(req) && !contradicted.includes(req));
  return {
    ...local,
    matched,
    missing,
    contradicted,
    risks: [...local.risks, ...clean(ai.risks)].filter((value, index, all) => all.indexOf(value) === index),
    questions: [...clean(ai.questions), ...missing.filter(req => !unknown.includes(req)).map(req => 'Подскажите, пожалуйста: ' + req + '?')],
    summary: String(ai.summary || local.summary).slice(0, 400),
    score: Math.max(0, Math.min(100, Math.round(82 + matched.length * 5 - missing.length * 9 - contradicted.length * 18 - (local.risks.length + clean(ai.risks).length) * 22))),
  };
}

export function parsePrice(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}
