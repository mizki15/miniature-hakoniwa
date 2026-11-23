{const set=(id,v,ev)=>{const e=document.getElementById(id); if(!e) return; e.value=v; e.dispatchEvent(new Event(ev,{bubbles:true}));};
set('time', window.__T ?? '10','input'); set('weather', window.__W ?? 'clear','change'); if (window.__S) set('season', window.__S, 'change');
for (const id of (window.__HIDE ?? ['ui'])) { const e=document.getElementById(id); if(e) e.style.visibility='hidden'; } 'ok'}
