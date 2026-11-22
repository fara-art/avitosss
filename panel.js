import {buildSearchUrl,isSafeAvitoUrl,matchesSearchCity,matchesSearchQuery,matchesPriceRange,upsertResult,shouldInspectCandidate,localAnalyze,mergeVerdicts,parseRequirements,parsePrice} from './core.js';
import {enableLocalPriority,scrollListing} from './local-priority.js';

const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const defaults={provider:'none',apiKey:'',model:''};
let settings={...defaults},results=[],saved=[],job=null;
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),3500)}
function view(name){document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===name));document.querySelectorAll('.nav').forEach(el=>el.classList.toggle('active',el.dataset.view===name));render()}
document.querySelectorAll('.nav').forEach(el=>el.onclick=()=>view(el.dataset.view));
$('settingsBtn').onclick=()=>view('settings');
const state=await chrome.storage.local.get(['settings','results','saved','draft']);
settings={...defaults,...state.settings};results=Array.isArray(state.results)?state.results:[];saved=Array.isArray(state.saved)?state.saved:[];
for(const [key,value] of Object.entries(state.draft||{}))if($(key)){if($(key).type==='checkbox')$(key).checked=value===true;else $(key).value=value}
function syncLimits(){$('searchLimits').hidden=$('continuous').checked}
syncLimits();
function setProvider(){const selected=$('provider').value;for(const id of ['apiKey','model','testApi'])$(id).disabled=selected==='none'}
$('provider').value=settings.provider;$('apiKey').value=settings.apiKey;$('model').value=settings.model;setProvider();
$('provider').onchange=()=>{$('model').value={none:'',openai:'gpt-4.1-nano',deepseek:'deepseek-chat'}[$('provider').value];setProvider()};
const currentSettings=()=>({provider:$('provider').value,apiKey:$('apiKey').value.trim(),model:$('model').value.trim()});
$('saveSettings').onclick=async()=>{const next=currentSettings();if(next.provider!=='none'&&(!next.apiKey||!next.model)){$('settingsStatus').textContent='Введите ключ и модель';return}settings=next;await chrome.storage.local.set({settings});$('settingsStatus').textContent='Сохранено в этом профиле Chrome';toast('Настройки сохранены')};
async function analyzeAI(item,requirements,config=settings){
  if(config.provider==='none'||!config.apiKey)return null;
  const endpoint=config.provider==='openai'?'https://api.openai.com/v1/chat/completions':'https://api.deepseek.com/chat/completions';
  const instruction='Верни JSON: {"matched":[],"missing":[],"contradicted":[],"risks":[],"questions":[],"summary":""}. Для каждого требования используй ровно один статус. Подтверждай только явные сведения; отсутствие факта означает missing. Отвечай по-русски.';
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,messages:[{role:'system',content:instruction},{role:'user',content:JSON.stringify({item:{title:item.title,description:item.description,specs:item.specs},requirements})}],response_format:{type:'json_object'},max_tokens:900})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error?.message||'Ошибка API: HTTP '+response.status);
  const content=data.choices?.[0]?.message?.content;if(!content)throw Error('API вернул пустой ответ');
  return JSON.parse(content);
}
$('testApi').onclick=async()=>{try{const config=currentSettings();if(!config.apiKey||!config.model)throw Error('Введите ключ и модель');$('settingsStatus').textContent='Проверяем…';await analyzeAI({title:'Тестовый телефон',description:'128 ГБ',specs:''},['Память 128 ГБ'],config);$('settingsStatus').textContent='Подключение работает'}catch(error){$('settingsStatus').textContent='Ошибка: '+error.message}};
$('templateBtn').onclick=()=>{$('requirements').value=/iphone|айфон|смартфон/i.test($('query').value)?'Память 128 ГБ; аккумулятор не ниже 85%; Face ID работает; нет блокировки iCloud; без ремонта':'Пробег до 1000 км; аккумулятор исправен; документы; зарядное устройство';toast('Шаблон можно изменить')};
const draft=()=>Object.fromEntries(['query','city','minPrice','maxPrice','condition','requirements','pages','limit','continuous','repeatOnNextSearch'].map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]));
document.querySelectorAll('#searchForm input,#searchForm textarea,#searchForm select').forEach(el=>el.onchange=()=>{if(el.id==='continuous')syncLimits();chrome.storage.local.set({draft:draft()});if(['query','city','minPrice','maxPrice'].includes(el.id))render()});
function progress(done,total,message){$('progress').classList.remove('hidden');$('track').classList.toggle('scanning',!Number.isFinite(total));$('progressNumbers').textContent=done+' найдено · '+(Number.isFinite(total)?'лимит '+total:'страница '+(job?.page||1));if(Number.isFinite(total))$('progressFill').style.width=Math.min(100,done/total*100)+'%';$('progressDetail').textContent=message}
async function gate(){while(job?.paused&&!job.stopped)await sleep(200);if(job?.stopped)throw Error('Поиск остановлен')}
async function waitWithGate(ms){for(let left=ms;left>0;left-=250){await gate();await sleep(Math.min(left,250))}}
$('pauseBtn').onclick=()=>{if(!job)return;job.paused=!job.paused;$('track').classList.toggle('paused',job.paused);$('pauseBtn').textContent=job.paused?'Продолжить':'Пауза';$('progressTitle').textContent=job.paused?'Поиск на паузе':'Идёт поиск'};
$('stopBtn').onclick=()=>{if(job){job.stopped=true;job.paused=false;toast('Остановка после текущего действия')}};
async function navigate(url){
  await gate();
  const tabId=job.tabId;
  await chrome.tabs.update(tabId,{url});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(Error('Страница не загрузилась за 45 секунд')),45000);function finish(error){clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);error?reject(error):resolve()}function listener(id,change){if(id===tabId&&change.status==='complete')finish()}chrome.tabs.onUpdated.addListener(listener);chrome.tabs.get(tabId).then(tab=>{if(tab.status==='complete'&&tab.url===url)finish()}).catch(()=>{})});
  const tab=await chrome.tabs.get(tabId);if(!isSafeAvitoUrl(tab.url))throw Error('Авито перенаправил на неизвестный сайт');
  await sleep(900);
}
async function scrape(func){const output=await chrome.scripting.executeScript({target:{tabId:job.tabId},func});return output?.[0]?.result}
function scrapeList(){
  const blocked=/captcha|капча|доступ ограничен|подтвердите.{0,30}(не робот|человек)/i.test(document.title+' '+document.body.innerText.slice(0,4000));
  const items=[],seen=new Set();
  for(const root of document.querySelectorAll('[data-marker="item"],[data-testid="item"],[data-item-id]')){
    const link=[...root.querySelectorAll('a[href]')].find(a=>{try{const u=new URL(a.href);return /_\d{6,}/.test(u.pathname)&&(u.hostname==='avito.ru'||u.hostname.endsWith('.avito.ru'))}catch{return false}});
    if(!link)continue;const url=new URL(link.href);url.search='';url.hash='';if(seen.has(url.href))continue;seen.add(url.href);
    const title=(root.querySelector('[data-marker="item-title"],[itemprop="name"],h3')?.textContent||link.textContent||'').trim();
    const priceText=root.querySelector('[data-marker="item-price"],[itemprop="price"]')?.textContent||root.textContent.match(/\d[\d\s ]*₽/)?.[0]||'';
    items.push({url:url.href,title,price:Number(priceText.replace(/\D/g,''))||0,image:root.querySelector('img')?.src||''});
  }
  return {items,blocked};
}
function scrapeDetail(){
  const find=(...selectors)=>{for(const selector of selectors){const text=document.querySelector(selector)?.textContent?.trim();if(text)return text}return ''};
  const body=document.body.innerText.slice(0,5000);
  return {title:find('h1')||document.title,description:find('[data-marker="item-view/item-description"]','[data-testid="item-description"]','[itemprop="description"]'),specs:[...document.querySelectorAll('[data-marker="item-view/item-params"] li,[data-testid="item-params"] li')].map(el=>el.textContent.trim()).join('; '),price:Number((find('[data-marker="item-view/item-price"]','[itemprop="price"]')||body.match(/\d[\d\s ]*₽/)?.[0]||'').replace(/\D/g,''))||0,location:find('[data-marker="item-view/item-address"]','[data-marker="item-view/item-location"]'),image:document.querySelector('meta[property="og:image"]')?.content||'',url:location.href,blocked:/captcha|капча|доступ ограничен|подтвердите.{0,30}(не робот|человек)/i.test(document.title+' '+body)};
}
$('searchForm').onsubmit=async event=>{
  event.preventDefault();if(job)return;
  const input=draft(),requirements=parseRequirements(input.requirements),minPrice=parsePrice(input.minPrice),maxPrice=parsePrice(input.maxPrice),pages=Math.min(10,Math.max(1,Number(input.pages)||1)),limit=input.continuous?Infinity:Math.min(100,Math.max(1,Number(input.limit)||30));
  if(minPrice&&maxPrice&&minPrice>maxPrice){toast('Цена «от» должна быть не выше цены «до»');$('minPrice').focus();return}
  let done=0,keepTab=false,localPriorityFound=false,page=1;const previous=new Set(results.map(item=>item.url)),seenThisRun=new Set(),seenPageSignatures=new Set();
  try{
    await chrome.storage.local.set({draft:input});
    const tab=await chrome.tabs.create({url:'about:blank',active:false});job={tabId:tab.id,paused:false,stopped:false,page:1};$('startBtn').disabled=true;$('track').classList.remove('paused');$('progressTitle').textContent='Идёт поиск';progress(0,limit,'Открываем выдачу…');$('progress').scrollIntoView({behavior:'smooth',block:'nearest'});
    while(input.continuous||page<=pages&&done<limit){
      await gate();job.page=page;
      await navigate(buildSearchUrl({query:input.query,city:input.city,page,minPrice,maxPrice}));
      if(input.city.trim().toLowerCase()!=='вся россия'){
        const priority=await scrape(enableLocalPriority);
        if(priority!=='not-found')localPriorityFound=true;
        if(priority==='enabled')await sleep(1600);
      }
      progress(done,limit,'Прокручиваем страницу '+page+'…');
      const scrolled=await scrape(scrollListing);
      await gate();
      const listing=await scrape(scrapeList);if(!listing||listing.blocked){keepTab=true;await chrome.tabs.update(job.tabId,{active:true});throw Error('Авито запросил проверку. Пройдите её во вкладке и повторите поиск')}
      listing.items=[...new Map([...(scrolled?.items||[]),...listing.items].map(item=>[item.url,item])).values()];
      const signature=listing.items.map(item=>item.url).join('|');
      if(!listing.items.length||seenPageSignatures.has(signature)){
        if(!input.continuous){if(page===1)throw Error('Карточки не прочитаны. Проверьте выдачу Авито');break}
        progress(done,limit,page===1?'Карточки не найдены. Повторим через 12 секунд':'Конец выдачи. Повторим проверку через 12 секунд');
        await waitWithGate(12000);page=1;seenPageSignatures.clear();continue;
      }
      seenPageSignatures.add(signature);
      for(const candidate of listing.items){
        await gate();if(done>=limit)break;if(!isSafeAvitoUrl(candidate.url)||!matchesSearchCity(candidate,input.city)||!matchesSearchQuery(candidate,input.query)||!shouldInspectCandidate(candidate.url,seenThisRun,previous,input.repeatOnNextSearch)||candidate.price&&!matchesPriceRange(candidate.price,minPrice,maxPrice))continue;
        seenThisRun.add(candidate.url);progress(done,limit,'Проверяем '+candidate.title.slice(0,55));await navigate(candidate.url);
        const detail=await scrape(scrapeDetail);if(!detail||detail.blocked){keepTab=true;await chrome.tabs.update(job.tabId,{active:true});throw Error('Авито запросил проверку. Пройдите её во вкладке и повторите поиск')}
        const item={...candidate,...detail,price:detail.price||candidate.price,image:detail.image||candidate.image};
        if(!matchesSearchCity(item,input.city)||!matchesSearchQuery(item,input.query)||!matchesPriceRange(item.price,minPrice,maxPrice))continue;
        const local=localAnalyze(item,requirements,{maxPrice,condition:input.condition});
        let ai=null;if(settings.provider!=='none'&&settings.apiKey)try{ai=await analyzeAI(item,requirements)}catch(error){local.risks.push('ИИ-анализ не выполнен: '+error.message.slice(0,90))}
        const old=results.find(value=>value.url===item.url);
        results=upsertResult(results,{...item,...mergeVerdicts(local,ai,requirements),id:old?.id||crypto.randomUUID(),checkedAt:Date.now()});done++;await chrome.storage.local.set({results});render();progress(done,limit,'Проверено: '+done);await waitWithGate(700+Math.random()*700);
      }
      page++;
      if(input.continuous&&page>100){progress(done,limit,'Возвращаемся к началу выдачи через 12 секунд');await waitWithGate(12000);page=1;seenPageSignatures.clear()}
      else if(input.continuous||page<=pages&&done<limit)await waitWithGate(1500);
    }
    const priorityMissing=!localPriorityFound&&input.city.trim().toLowerCase()!=='вся россия';
    $('progressTitle').textContent='Поиск завершён';progress(done,limit,priorityMissing?'Галочка Авито не найдена; город проверен у каждого объявления':'Результаты сохранены');$('track').classList.remove('scanning');$('progressFill').style.width='100%';$('resultNotice').textContent=priorityMissing?'Переключатель «сначала из города» не найден на странице Авито. Результаты всё равно проверены по городу объявления.':'';view('results');toast('Проверено объявлений: '+done);
  }catch(error){$('progressTitle').textContent=job?.stopped?'Поиск остановлен':'Поиск прерван';$('progressDetail').textContent=job?.stopped?'Сохранено результатов: '+done:error.message;toast(job?.stopped?'Поиск остановлен. Найдено: '+done:error.message)}
  finally{const tabId=job?.tabId;job=null;$('track').classList.remove('scanning');$('startBtn').disabled=false;if(tabId&&!keepTab)chrome.tabs.remove(tabId).catch(()=>{})}
};
function card(item,isSaved){
  const el=document.createElement('article');el.className='card';const top=document.createElement('div');top.className='card-top';
  if(item.image?.startsWith('https://')){const image=document.createElement('img');image.src=item.image;image.alt='';image.loading='lazy';top.append(image)}
  const main=document.createElement('div');main.className='card-main';const title=document.createElement('h2');title.textContent=item.title||'Объявление';
  const price=document.createElement('div');price.className='price';price.textContent=item.price?new Intl.NumberFormat('ru-RU').format(item.price)+' ₽':'Цена не указана';
  const location=document.createElement('div');location.className='meta';location.textContent=item.location||'Авито';
  const badge=document.createElement('span');badge.className='badge '+(item.risks?.length?'risk':item.missing?.length?'ask':'');badge.textContent=item.risks?.length?'Есть риск':item.missing?.length?'Нужно уточнить':'Подходит';main.append(title,price,location,badge);top.append(main);
  const body=document.createElement('div');body.className='card-body';
  const summary=document.createElement('p');summary.className='card-summary';summary.textContent=item.summary||'';body.append(summary);
  const details=document.createElement('details');details.className='card-details';const toggle=document.createElement('summary');toggle.textContent='Подробнее об объявлении';details.append(toggle);
  for(const [label,values] of [['Подтверждено',item.matched],['Нужно уточнить',item.missing],['Противоречит',item.contradicted],['Риски',item.risks]])if(values?.length){const p=document.createElement('p');p.textContent=label+': '+values.join('; ');details.append(p)}
  body.append(details);
  const actions=document.createElement('div');actions.className='card-actions';const link=document.createElement('a');link.href=isSafeAvitoUrl(item.url)?item.url:'https://www.avito.ru/';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Открыть ↗';
  const questions=document.createElement('button');questions.textContent='Вопросы';questions.onclick=async()=>{const list=item.questions?.length?item.questions:item.missing?.map(value=>'Подскажите, пожалуйста: '+value+'?')||[];if(!list.length)return toast('Вопросов пока нет');try{await navigator.clipboard.writeText('Здравствуйте! '+list.join(' '));toast('Вопросы скопированы')}catch{toast('Не удалось скопировать сообщение')}};
  const save=document.createElement('button');save.textContent=isSaved?'Убрать':'Сохранить';save.onclick=async()=>{saved=isSaved?saved.filter(value=>value.url!==item.url):[item,...saved.filter(value=>value.url!==item.url)];await chrome.storage.local.set({saved});render()};actions.append(link,questions,save);el.append(top,body,actions);return el;
}
function render(){const query=$('query').value.trim(),minPrice=parsePrice($('minPrice').value),maxPrice=parsePrice($('maxPrice').value);const ordered=results.filter(item=>matchesSearchCity(item,$('city').value)&&(!query||matchesSearchQuery(item,query))&&matchesPriceRange(item.price,minPrice,maxPrice)).sort($('sort').value==='price'?(a,b)=>(a.price||Infinity)-(b.price||Infinity):(a,b)=>(b.score||0)-(a.score||0));$('resultCount').textContent=ordered.length;$('savedCount').textContent=saved.length;
  for(const [id,items,message] of [['resultList',ordered,'Пока нет результатов. Начните поиск.'],['savedList',saved,'Сохранённые объявления появятся здесь.']]){const root=$(id);if(!root.closest('.view').classList.contains('active'))continue;root.replaceChildren();if(!items.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=message;root.append(empty)}else for(const item of items)root.append(card(item,saved.some(value=>value.url===item.url)))}
  $('clearResults').hidden=!results.length;$('clearSaved').hidden=!saved.length;
}
$('sort').onchange=render;
$('clearResults').onclick=async()=>{if(!confirm('Удалить результаты? Сохранённые объявления останутся.'))return;results=[];await chrome.storage.local.set({results});render()};
$('clearSaved').onclick=async()=>{if(!confirm('Удалить сохранённые объявления?'))return;saved=[];await chrome.storage.local.set({saved});render()};
render();
