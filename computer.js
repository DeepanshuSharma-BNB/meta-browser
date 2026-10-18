'use strict';
const $=VISOR.$;
let paired=false,ready=false,stream=null,peerVideo=false,timer=null,lastShot=0;
const el=$('status'),preview=$('preview');
function label(s){el.textContent=s;}
function note(s){$('note').textContent=s;}
function setButtons(){$('share').disabled=!paired||!!stream;$('stop').disabled=!stream;}
let link=VISOR.connect(msg=>{
  if(msg.type==='joined'){paired=true;label('● Glasses paired');note('Choose a Chrome tab or window to share.');setButtons();}
  else if(msg.type==='video_confirmed'){peerVideo=true;clearInterval(timer);timer=null;label('● Live WebRTC video confirmed');note('Streaming live video through the peer connection.');}
  else if(msg.type==='needs_frames'){startSnapshots();}
  else if(msg.type==='zoom'){note('Glasses zoom: '+msg.value.toFixed(1)+'×');}
  else if(msg.type==='error'){note(msg.message);}
},state=>{ready=state==='online';if(!ready){paired=false;stop(false);label('○ Relay offline')}else label('● Ready to pair');$('pair').disabled=!ready||paired;setButtons()});
$('pair-form').onsubmit=e=>{e.preventDefault();link.send({type:'join',code:$('pin').value.toUpperCase().replace(/[^A-Z2-9]/g,'')});label('Pairing…');};
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
