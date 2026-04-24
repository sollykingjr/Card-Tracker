// ── App state ─────────────────────────────────────────────────────────────────
let tab='all', brf='all', posf='all', q='', sortBy='default';

// ── Search helper (needs q and TEAM_NAMES from config) ────────────────────────
const matchQ=(name,team)=>{
  if(!q) return true;
  const t=q.toLowerCase();
  return (name||'').toLowerCase().includes(t)||
         (team||'').toLowerCase().includes(t)||
         (TEAM_NAMES[team||'']||'').toLowerCase().includes(t);
};

// ── Events ────────────────────────────────────────────────────────────────────
document.getElementById('tabs').addEventListener('click',e=>{
  const t=e.target.closest('.tab'); if(!t) return;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
  t.classList.add('on'); tab=t.dataset.t; sortBy='default'; window.scrollTo(0,0); render();
});
document.getElementById('sortchips').addEventListener('click',e=>{
  const c=e.target.closest('.schip'); if(!c) return;
  sortBy=c.dataset.s; render();
});
document.getElementById('chips').addEventListener('click',e=>{
  const c=e.target.closest('.chip'); if(!c) return;
  document.querySelectorAll('#chips .chip').forEach(x=>x.classList.remove('on'));
  c.classList.add('on'); brf=c.dataset.f; render();
});
document.getElementById('chips2').addEventListener('click',e=>{
  const c=e.target.closest('.chip'); if(!c) return;
  document.querySelectorAll('#chips2 .chip').forEach(x=>x.classList.remove('on'));
  c.classList.add('on'); posf=c.dataset.p; render();
});
document.getElementById('search').addEventListener('input',e=>{
  q=e.target.value.trim();
  document.getElementById('clear').classList.toggle('on',q.length>0);
  render();
});
document.getElementById('clear').addEventListener('click',()=>{
  document.getElementById('search').value=''; q='';
  document.getElementById('clear').classList.remove('on'); render();
});
document.getElementById('closebtn').addEventListener('click',()=>document.getElementById('mwrap').classList.remove('on'));
document.getElementById('mwrap').addEventListener('click',e=>{ if(e.target===document.getElementById('mwrap')) document.getElementById('mwrap').classList.remove('on'); });
document.getElementById('rfab').addEventListener('click',loadAll);

// ── Init ──────────────────────────────────────────────────────────────────────
loadAll();
