'use strict';
const $=VISOR.$;
let paired=false,ready=false,pairingAttempt=false,stream=null,peerVideo=false,timer=null,lastShot=0;
const el=$('status'),preview=$('preview');
function label(s){el.textContent=s;}
function note(s){$('note').textContent=s;}
function setButtons(){
  $('share').disabled=!paired||!!stream;
  $('stop').disabled=!stream;
  $('pair').disabled=!ready||paired||pairingAttempt;
}
function feedback(text,problem=false){
  const el=$('pair-feedback');
  if(el){el.textContent=text;el.style.color=problem?'#ffbbbb':'#a5f5d5';}
}
let link=VISOR.connect(msg=>{
  if(msg.type==='joined'){
    paired=true;pairingAttempt=false;
    label('● Glasses paired');
    feedback('Connected successfully. You can start sharing.');
    note('Choose a Chrome tab or window to share.');setButtons();
  }
  else if(msg.type==='pair_status'){
    switch(msg.phase){
      case 'deriving_key':label('Pairing · preparing encryption');feedback('Deriving encrypted session keys…');break;
      case 'joining':label('Pairing · waiting for glasses');feedback('Request '+msg.attempt+': waiting for a response from the glasses.');break;
      case 'relay_offline':pairingAttempt=false;label('○ Relay disconnected');feedback('Pairing relay is offline or blocked. Keep the glasses viewer open and check its connection status.',true);break;
      case 'subscribe_failed':pairingAttempt=false;label('Pairing unavailable');feedback('Could not subscribe to relay. Reload both pages and retry.',true);break;
      case 'invalid_code':pairingAttempt=false;label('Invalid pairing code');feedback('Use the entire 12-character code shown on the glasses.',true);break;
    }
    setButtons();
  }
  else if(msg.type==='pair_timeout'){
    pairingAttempt=false;label('Pairing timed out');
    feedback(msg.message||'Glasses did not respond. Try again.',true);
    setButtons();
  }
  else if(msg.type==='video_confirmed'){peerVideo=true;clearInterval(timer);timer=null;label('● Live WebRTC video confirmed');note('Streaming live video through the peer connection.');}
  else if(msg.type==='needs_frames'){startSnapshots();}
  else if(msg.type==='zoom'){note('Glasses zoom: '+msg.value.toFixed(1)+'×');}
  else if(msg.type==='error'){
    note(msg.message);
    if(!paired){pairingAttempt=false;label('Pairing error');feedback(msg.message,true);setButtons();}
  }
},state=>{
  ready=state==='online';
  if(!ready){
    paired=false;pairingAttempt=false;stop(false);label('○ Relay offline');
    feedback('Relay connection unavailable. Pairing cannot start until connected.',true);
  }else {
    label('● Relay connected');
    if(!paired&&!pairingAttempt)feedback('Enter the code shown on your glasses. The glasses should say “Pairing ready”.');
  }
  setButtons();
}, {role:'computer'});
$('pair-form').onsubmit=e=>{
  e.preventDefault();
  if(!ready){feedback('The connection relay is offline. Retry once it connects.',true);return;}
  const code=$('pin').value.toUpperCase().replace(/\s+/g,'').replace(/-/g,'');
  if(!/^[A-HJ-NP-Z2-9]{12}$/.test(code)){
    feedback('Enter the complete 12-character glasses code (letters and digits 2–9).',true);return;
  }
  pairingAttempt=true;label('Pairing · preparing encryption');
  feedback('Connecting to the glasses. This can take several seconds…');
  setButtons();link.send({type:'join',code});
};
$('share').onclick=async()=>{
  if(!paired)return;
  if(!navigator.mediaDevices?.getDisplayMedia){note('This desktop browser cannot capture the screen. Use Chrome/Edge over HTTPS.');return;}
  try{
    stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:12,max:15},width:{ideal:1280},height:{ideal:720}},audio:false});
    preview.srcObject=stream;await preview.play().catch(()=>{});
    stream.getVideoTracks()[0].onended=()=>stop(true);
    peerVideo=false;label('Connecting WebRTC…');note('Waiting for video playback confirmation from the glasses.');
    setButtons();link.sendStream(stream).catch(e=>note('WebRTC: '+e.message));
    setTimeout(()=>{if(stream&&!peerVideo)startSnapshots();},9000);
  }catch(e){note(e.name==='NotAllowedError'?'Sharing cancelled.':e.message);}
};
function stop(notify){clearInterval(timer);timer=null;if(stream)for(const t of stream.getTracks())t.stop();stream=null;preview.srcObject=null;peerVideo=false;setButtons();if(notify&&paired)link.send({type:'stop'});if(notify)label('Sharing stopped');}
$('stop').onclick=()=>stop(true);
function shot(){
  if(!stream||preview.readyState<2||peerVideo||Date.now()-lastShot<1200)return;lastShot=Date.now();
  const c=$('frame'),w=preview.videoWidth,h=preview.videoHeight;if(!w||!h)return;
  let max=660,q=.58,data='';
  for(let i=0;i<5;i++){const k=Math.min(1,max/Math.max(w,h));c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));c.getContext('2d',{alpha:false}).drawImage(preview,0,0,c.width,c.height);data=c.toDataURL('image/jpeg',q);if(data.length<155000)break;max*=.77;q-=.05;}
  if(data.length<175000)link.send({type:'frame',data});
}
function startSnapshots(){if(!stream||peerVideo)return;clearInterval(timer);timer=setInterval(shot,2200);shot();label('● Encrypted screenshot mode');note('Your glasses may not support WebRTC video. Images refresh about every 2 seconds.');}
$('snapshot').onclick=()=>{shot();note('Requested another encrypted screenshot.');};
window.addEventListener('pagehide',()=>{stop(false);link.close()});setButtons();
