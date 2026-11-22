// This function is also serialized into an Avito tab by chrome.scripting.
export function enableLocalPriority(){
  const labelText=/(сначала.{0,60}(город|регион|местн)|сначала\s+из)/i;
  for(const label of document.querySelectorAll('label,[role="checkbox"]')){
    if(!labelText.test((label.textContent||'').replace(/\s+/g,' ')))continue;
    const control=label.matches('[role="checkbox"]')?label:label.control||label.querySelector('input[type="checkbox"],[role="checkbox"]');
    if(!control||control.disabled||control.getAttribute('aria-disabled')==='true')continue;
    const checked=control.matches('input')?control.checked:control.getAttribute('aria-checked')==='true';
    if(checked)return 'already-enabled';
    control.click();
    return 'enabled';
  }
  return 'not-found';
}

// Serialized into a listing tab. Scroll in short steps so lazy-loaded cards appear.
export async function scrollListing(){
  const items=new Map();
  function collect(){
    for(const root of document.querySelectorAll('[data-marker="item"],[data-testid="item"],[data-item-id]')){
      const link=[...root.querySelectorAll('a[href]')].find(anchor=>{
        try{const url=new URL(anchor.href);return /_\d{6,}/.test(url.pathname)&&(url.hostname==='avito.ru'||url.hostname.endsWith('.avito.ru'))}catch{return false}
      });
      if(!link)continue;
      const url=new URL(link.href);url.search='';url.hash='';
      const title=(root.querySelector('[data-marker="item-title"],[itemprop="name"],h3')?.textContent||link.textContent||'').trim();
      const priceText=root.querySelector('[data-marker="item-price"],[itemprop="price"]')?.textContent||root.textContent.match(/\d[\d\s ]*₽/)?.[0]||'';
      items.set(url.href,{url:url.href,title,price:Number(priceText.replace(/\D/g,''))||0,image:root.querySelector('img')?.src||''});
    }
  }
  collect();
  let lastHeight=0;
  for(let step=0;step<36;step++){
    window.scrollBy(0,Math.max(320,Math.floor(window.innerHeight*.85)));
    await new Promise(resolve=>setTimeout(resolve,180));
    collect();
    const height=document.documentElement.scrollHeight;
    if(window.scrollY+window.innerHeight>=height-20&&height===lastHeight)break;
    lastHeight=height;
  }
  return {height:document.documentElement.scrollHeight,position:window.scrollY,items:[...items.values()]};
}
