{const set=(id,v,ev)=>{const e=document.getElementById(id); if(!e) return; e.value=v; e.dispatchEvent(new Event(ev,{bubbles:true}));};
set('time', window.__T ?? '15.5','input'); set('weather', window.__W ?? 'clear','change');
for (const id of ['left','right','ui']) { const e=document.getElementById(id); if(e) e.style.visibility='hidden'; } 'ok'}
