'use strict';
const $=VISOR.$;
let ready=false,paired=false,mediaReady=false,zoom=1,x=0,y=0,check=null,drag=null;
const stage=$('stage'),movie=$('movie'),image=$('image');
function hint(t){$('notice').textContent=t;$('notice').classList.remove('hidden');clearTimeout(hint.timer);hint.timer=setTimeout(()=>$('notice').classList.add('hidden'),2200);}
function layout(m){$('pair').classList.toggle('hidden',m!=='pair');$('waiting').classList.toggle('hidden',m!=='waiting');movie.classList.toggle('hidden',m!=='movie');image.classList.toggle('hidden',m!=='image');if(m==='movie'||m==='image')try{stage.focus({preventScroll:true})}catch{}}
function transform(){x=Math.max(-stage.clientWidth*(zoom-1)/2,Math.min(stage.clientWidth*(zoom-1)/2,x));y=Math.max(-stage.clientHeight*(zoom-1)/2,Math.min(stage.clientHeight*(zoom-1)/2,y));const t='translate('+x+'px,'+y+'px) scale('+zoom+')';movie.style.transform=t;image.style.transform=t;}
function magnify(value){zoom=Math.max(1,Math.min(4,value));if(zoom===1){x=0;y=0}transform();if(paired)link.send({type:'zoom',value:zoom});}
let link=VISOR.connect(msg=>{
  if(msg.type==='room'){$('code').textContent=msg.code.slice(0,4)+' '+msg.code.slice(4,8)+' '+msg.code.slice(8);layout('pair');$('connect').textContent=msg.ready?'● Pairing ready. Enter this code on your computer.':'Code generated. Connecting to relay…';}
  else if(msg.type==='paired'){paired=true;layout('waiting');}
  else if(msg.type==='remote_stream'){
    movie.srcObject=msg.stream;movie.play().catch(()=>{});mediaReady=false;
    clearTimeout(check);check=setTimeout(()=>{if(!mediaReady)link.send({type:'needs_frames'});},6500);
  }
  else if(msg.type==='frame'&&typeof msg.data==='string'&&msg.data.startsWith('data:image/jpeg;base64,')&&!mediaReady){image.src=msg.data;layout('image');}
  else if(msg.type==='stop'){movie.pause();movie.srcObject=null;image.removeAttribute('src');mediaReady=false;layout('waiting');}
  else if(msg.type==='disconnected'){paired=false;mediaReady=false;layout('pair');}
  else if(msg.type==='error'){
    const problem=msg.message||'Connection problem';
    hint(problem);
    if(!paired)$('connect').textContent='Pairing unavailable: '+problem;
  }
  else if(msg.type==='pair_status'){
    if(msg.phase==='subscribe_failed')$('connect').textContent='Could not subscribe to relay. Reload this page.';
  }
},state=>{
  ready=state==='online';
  if(!window.crypto?.subtle){
    $('connect').textContent='Secure Web Crypto unavailable here. Open the glasses URL directly in a browser, outside this simulator.';
    return;
  }
  if(ready){
    paired=false;mediaReady=false;layout('pair');
    $('connect').textContent='Relay connected. Preparing encrypted pairing…';
  }else{
    paired=false;layout('pair');
    $('connect').textContent='Relay unavailable. Retrying… Try opening the glasses URL directly if this persists.';
  }
}, {role:'glasses',initialCode:window.__visorBrowserPairCode});
movie.addEventListener('playing',()=>{if(movie.videoWidth>0&&movie.videoHeight>0){mediaReady=true;clearTimeout(check);layout('movie');link.send({type:'video_confirmed'});}});
function key(e){
  if($('pair').classList.contains('hidden')===false||$('waiting').classList.contains('hidden')===false)return;
  if(e.key==='ArrowUp'){e.preventDefault();magnify(zoom*1.25);}
  if(e.key==='ArrowDown'){e.preventDefault();magnify(zoom/1.25);}
  if(e.key==='ArrowLeft'&&zoom>1){e.preventDefault();x+=60;transform();}
  if(e.key==='ArrowRight'&&zoom>1){e.preventDefault();x-=60;transform();}
  if(e.key==='Enter'||e.key===' '){e.preventDefault();magnify(zoom>1.1?1:1.7);}
  if(e.key==='Escape'){e.preventDefault();magnify(1);}
}
window.addEventListener('keydown',key,{passive:false});
stage.addEventListener('pointerdown',e=>{if(!$('pair').classList.contains('hidden')||!$('waiting').classList.contains('hidden'))return;drag={id:e.pointerId,px:e.clientX,py:e.clientY,axis:null};try{stage.setPointerCapture(e.pointerId)}catch{}});
stage.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;let dx=e.clientX-drag.px,dy=e.clientY-drag.py;drag.px=e.clientX;drag.py=e.clientY;if(!drag.axis&&Math.hypot(dx,dy)>2)drag.axis=Math.abs(dy)>Math.abs(dx)?'zoom':'pan';if(drag.axis==='zoom')magnify(zoom*Math.exp(-dy*.012));else if(zoom>1){x+=dx;y+=dy;transform();}e.preventDefault();},{passive:false});
stage.addEventListener('pointerup',()=>drag=null);stage.addEventListener('pointercancel',()=>drag=null);
window.addEventListener('resize',transform);window.addEventListener('pagehide',()=>link.close());
layout('pair');
// Display a code immediately, even before the relay responds.
link.send({type:'create'});
if(!window.crypto?.subtle)
  $('connect').textContent='Secure Web Crypto unavailable. The simulator may be restricting browser APIs. Open this page directly.';

window.__visorBrowserStarted = true;
