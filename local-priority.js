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
