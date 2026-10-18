/* Visor Browser: encrypted photo exchange. WebRTC direct channel preferred;
 * encrypted MQTT test relay is used for pairing/signaling and fallback.
 * Experimental. Not for confidential media.
 */
'use strict';
const VISOR = (() => {
  const BROKERS = ['wss://broker.emqx.io:8084/mqtt'];
  const CHANNEL = 'visor-browser-v1';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const te = new TextEncoder(), td = new TextDecoder();
  const $ = id => document.getElementById(id);
  const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));
  const randomCode = () => Array.from(randomBytes(12),x=>ALPHABET[x%ALPHABET.length]).join('');
  const concat = (...arrays) => {const out=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let at=0;for(const a of arrays){out.set(a,at);at+=a.length;}return out;};
  const be16 = n => new Uint8Array([n>>>8&255,n&255]);
  function encodedLength(n){const a=[n%128];n=Math.floor(n/128);while(n>0){a[a.length-1]|=128;a.push(n%128);n=Math.floor(n/128);}return new Uint8Array(a);}
  function packet(type,payload){return concat(new Uint8Array([type]),encodedLength(payload.length),payload);}
  function str(s){const b=te.encode(s);return concat(be16(b.length),b);}
  function readRemaining(b,offset){let n=0,m=1,c,i=offset;do{if(i>=b.length)throw Error('Bad MQTT packet');c=b[i++];n+=(c&127)*m;m*=128;}while(c&128);return [n,i];}
  const b64 = bytes => {let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
  async function roomConfig(code){
    // The public broker only sees a hashed room identifier, not the secret pairing code.
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(CHANNEL+':room:'+code)));
    const topic = 'visor/browser/v1/'+[...digest].slice(0,18).map(x=>x.toString(16).padStart(2,'0')).join('');
    const material=await crypto.subtle.importKey('raw',te.encode(code),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:te.encode(CHANNEL+':key'),iterations:300000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    return {topic,key};
  }
  async function seal(key,message){const iv=randomBytes(12);const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,te.encode(JSON.stringify(message))));return concat(iv,ciphertext);}
  async function unseal(key,data){const b=new Uint8Array(data);if(b.length<29)throw Error('Small packet');const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12)},key,b.slice(12));return JSON.parse(td.decode(clear));}

  class MqttConnection {
    constructor(onData,onStatus){this.ws=null;this.onData=onData;this.onStatus=onStatus;this.ready=false;this.closed=false;this.packetId=0;this.subs=new Map();this.topics=new Set();this.retry=0;this.keep=null;this.broker=0;this.open();}
    open(){if(this.closed)return;this.ready=false;const url=BROKERS[this.broker];let ws;try{ws=new WebSocket(url,['mqtt']);}catch(e){this.retryOpen();return;}
      this.ws=ws;ws.binaryType='arraybuffer';
      ws.onopen=()=>{const id='vg'+[...randomBytes(8)].map(x=>x.toString(16).padStart(2,'0')).join('');const variable=concat(str('MQTT'),new Uint8Array([4,2,0,25]));ws.send(packet(0x10,concat(variable,str(id))));};
      ws.onmessage=e=>{if(e.data instanceof Blob){e.data.arrayBuffer().then(b=>this.parse(b)).catch(()=>{});}else this.parse(e.data);};
      ws.onclose=()=>{this.ready=false;clearInterval(this.keep);this.onStatus('offline');if(!this.closed)this.retryOpen();};
      ws.onerror=()=>{ /* onclose will report and retry */ };
    }
    retryOpen(){clearTimeout(this.retry);this.retry=setTimeout(()=>this.open(),2300);}
    parse(raw){const b=new Uint8Array(raw);let p=0;while(p<b.length){const type=b[p++];let n,start;try{[n,start]=readRemaining(b,p);}catch{return;}if(start+n>b.length)return;const payload=b.subarray(start,start+n);p=start+n;
        if((type>>4)===2){if(payload[1]!==0){this.ws?.close();continue;}this.ready=true;this.onStatus('online');clearInterval(this.keep);this.keep=setInterval(()=>this.raw(packet(0xC0,new Uint8Array(0))),18000);for(const topic of this.topics)this.subscribe(topic);}
        else if((type>>4)===3){if(payload.length<2)continue;const size=payload[0]*256+payload[1];if(size+2>payload.length)continue;const topic=td.decode(payload.subarray(2,2+size));this.onData(topic,payload.subarray(2+size));}
        else if((type>>4)===9){if(payload.length<3)continue;const id=payload[0]*256+payload[1];const cb=this.subs.get(id);if(cb){this.subs.delete(id);cb(payload[2]!==128);}}
      }}
    raw(bytes){if(this.ready&&this.ws?.readyState===WebSocket.OPEN)this.ws.send(bytes);}
    subscribe(topic){this.topics.add(topic);if(!this.ready)return Promise.resolve(false);return new Promise(resolve=>{const id=++this.packetId%65535||1;this.subs.set(id,resolve);this.raw(packet(0x82,concat(be16(id),str(topic),new Uint8Array([0]))));setTimeout(()=>{if(this.subs.has(id)){this.subs.delete(id);resolve(false);}},7000);});}
    unsubscribe(topic){this.topics.delete(topic);if(this.ready){const id=++this.packetId%65535||1;this.raw(packet(0xA2,concat(be16(id),str(topic))));}}
    publish(topic,payload){if(!this.ready)return false;this.raw(packet(0x30,concat(str(topic),payload)));return true;}
    close(){this.closed=true;clearTimeout(this.retry);clearInterval(this.keep);if(this.ready)this.raw(packet(0xE0,new Uint8Array(0)));this.ws?.close();}
  }

  function connect(onMessage,onState){
    const isGlasses = /(^|\/)glasses\.html$/.test(location.pathname);
    let room=null, code='', connected=false, desiredCode='', pairTimer=null, seq=0,pairedAt=0;
    let sending=Promise.resolve(),directSending=Promise.resolve();let reassembly=new Map();let generation=0;let heartbeat=null,lastPong=0;
    let pc=null,dc=null,directReady=false,desiredStream=null;
    let pendingIce=[];
    let seen=new Map();
    function resetRTC(){
      directReady=false;if(dc){try{dc.close()}catch{}}if(pc){try{pc.close()}catch{}}
      dc=null;pc=null;
    }
    function directPacket(obj){if(!dc||dc.readyState!=='open')return;const raw=JSON.stringify(obj);if(raw.length>16000)return;
      dc.send(raw);
    }
    function setupChannel(channel){
      dc=channel;dc.binaryType='arraybuffer';dc.bufferedAmountLowThreshold=131072;
      dc.onopen=()=>{directReady=true;local({type:'direct',available:true});};
      dc.onclose=()=>{directReady=false;local({type:'direct',available:false});};
      dc.onerror=()=>{directReady=false;local({type:'direct',available:false});};
      dc.onmessage=e=>{
        // Direct channel accepts only bounded, JSON-encoded photo/control fragments.
        if(typeof e.data!=='string'||e.data.length>17000)return;
        let message;try{message=JSON.parse(e.data)}catch{return;}
        if(message?.type==='dchunk')handleDirectChunk(message);
      };
    }
    async function createRTC(initiator){
      if(typeof RTCPeerConnection==='undefined'){local({type:'direct',available:false});return;}
      resetRTC();
      try{
        const peer=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});pc=peer;
        peer.onicecandidate=e=>{if(e.candidate)queue({type:'ice',candidate:e.candidate.toJSON()});};
        peer.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(peer.connectionState)&&directReady){directReady=false;local({type:'direct',available:false});}};
        peer.ondatachannel=e=>setupChannel(e.channel);
        peer.ontrack=e=>local({type:'remote_stream',stream:e.streams[0]||new MediaStream([e.track])});
        if(initiator){setupChannel(peer.createDataChannel('visor-browser',{ordered:true}));if(desiredStream)for(const track of desiredStream.getTracks())peer.addTrack(track,desiredStream);await peer.setLocalDescription(await peer.createOffer());queue({type:'offer',sdp:peer.localDescription.toJSON()});}
      }catch(e){local({type:'direct',available:false});}
    }
    async function flushIce(){while(pc&&pc.remoteDescription&&pendingIce.length){try{await pc.addIceCandidate(pendingIce.shift())}catch{}}}
    async function rtcSignal(msg){
      try{
        if(msg.type==='offer'){
          await createRTC(false);if(!pc)return;await pc.setRemoteDescription(msg.sdp);await flushIce();await pc.setLocalDescription(await pc.createAnswer());queue({type:'answer',sdp:pc.localDescription.toJSON()});
        }else if(msg.type==='answer' && pc){await pc.setRemoteDescription(msg.sdp);await flushIce();}
        else if(msg.type==='ice'){
          if(pc&&pc.remoteDescription)await pc.addIceCandidate(msg.candidate);
          else if(pendingIce.length<60)pendingIce.push(msg.candidate);
        }
      }catch(e){console.warn('Peer connection:',e.message);}
    }
    let pendingDirect=new Map();
    function handleDirectChunk(msg){
      const {sid,part,count,text}=msg;
      if(typeof sid!=='string'||sid.length>40||!Number.isInteger(count)||count<1||count>300||!Number.isInteger(part)||part<0||part>=count||typeof text!=='string'||text.length>15000)return;
      let x=pendingDirect.get(sid);if(!x){x={parts:new Array(count),have:0,at:Date.now()};pendingDirect.set(sid,x);}
      if(x.parts.length!==count)return;
      if(x.parts[part]===undefined){x.parts[part]=text;x.have++;}
      if(x.have===count){pendingDirect.delete(sid);try{local(JSON.parse(x.parts.join('')))}catch{}}
      if(pendingDirect.size>30)for(const [k,v] of pendingDirect)if(Date.now()-v.at>20000)pendingDirect.delete(k);
    }
    function sendDirect(msg){
      if(!directReady||!dc)return false;
      const text=JSON.stringify(msg),n=Math.ceil(text.length/12000);
      if(n>300)return false;
      const sid=b64(randomBytes(9)).replace(/[^a-zA-Z0-9]/g,'');
      directSending=directSending.catch(()=>{}).then(async()=>{
        for(let i=0;i<n;i++){
          if(!dc||dc.readyState!=='open')return;
          while(dc.bufferedAmount>450000&&dc.readyState==='open')await new Promise(r=>setTimeout(r,25));
          directPacket({type:'dchunk',sid,part:i,count:n,text:text.slice(i*12000,(i+1)*12000)});
        }
      });
      return true;
    }
    const handleError = error => onMessage({type:'error',message:error?.message||'Connection failed'});
    const wire = new MqttConnection(receive, state => {
      connected=state==='online';onState(state);
      if(connected&&code){const old=code;startRoom(old,isGlasses,true).catch(handleError);}
      else if(connected && !isGlasses && desiredCode){startRoom(desiredCode,false,true).catch(handleError);}
    });
    function local(obj){onMessage(obj);}
    function queue(msg){if(!room||!connected)return;const target=isGlasses?'/phone':'/glasses';const stamp=++seq+'-'+b64(randomBytes(6)).replace(/[^a-zA-Z0-9]/g,'');const chunks=[];const serialized=JSON.stringify(msg);for(let i=0;i<serialized.length;i+=16500)chunks.push(serialized.slice(i,i+16500));
      const current=room;
      sending=sending.catch(()=>{}).then(async()=>{
        for(let i=0;i<chunks.length;i++){
          if(current!==room||!connected)return;
          const data=await seal(current.key,{sid:stamp,part:i,count:chunks.length,text:chunks[i]});
          wire.publish(current.topic+target,data);
          if(chunks.length>1)await new Promise(r=>setTimeout(r,13));
        }
      }).catch(handleError);
    }
    let paired=false;
    async function startRoom(pin,asGlasses,repeat){
      const myGen=++generation;const config=await roomConfig(pin);if(myGen!==generation)return;
      if(code!==pin){if(room)wire.unsubscribe(room.topic+(asGlasses?'/glasses':'/phone'));resetRTC();pendingIce=[];reassembly.clear();pendingDirect.clear();seen.clear();paired=false;pairedAt=0;}
      code=pin;room=config;const incoming=config.topic+(asGlasses?'/glasses':'/phone');const ok=await wire.subscribe(incoming);if(myGen!==generation)return;
      if(!ok){handleError(new Error('Relay subscription failed. Retry loading the page.'));return;}
      if(asGlasses){local({type:'room',code:pin,ready:true});}
      else {queue({type:'join'});clearTimeout(pairTimer);pairTimer=setTimeout(()=>{if(!paired)handleError(new Error('No glasses response. Check the code and keep the glasses app open.'));},11000);}
    }
    async function receive(topic,payload){const current=room;if(!current)return;if(topic!==current.topic+(isGlasses?'/glasses':'/phone'))return;
      let envelope;try{envelope=await unseal(current.key,payload);}catch{return;}if(current!==room)return;
      const {sid,part,count,text}=envelope;if(typeof sid!=='string'||!Number.isInteger(part)||!Number.isInteger(count)||count<1||count>130||part<0||part>=count||typeof text!=='string'||text.length>17000)return;
      let partial=reassembly.get(sid);
      if(!partial){partial={parts:new Array(count),received:0,at:Date.now()};reassembly.set(sid,partial);}
      if(partial.parts.length!==count)return;
      // Sparse Array.every() skips missing indexes and previously caused large photos
      // to be parsed after only their first chunk. Track every received part explicitly.
      if(partial.parts[part]===undefined){partial.parts[part]=text;partial.received++;}
      if(partial.received===count){reassembly.delete(sid);let msg;try{msg=JSON.parse(partial.parts.join(''));}catch{return;}
        if(seen.has(sid))return;seen.set(sid,Date.now());
        if(seen.size>400){for(const [k,t] of seen)if(Date.now()-t>180000)seen.delete(k);}
        if(msg.type==='join'&&isGlasses){paired=true;pairedAt=Date.now();local({type:'paired'});queue({type:'joined',code});}
        else if(msg.type==='joined'&&!isGlasses){paired=true;pairedAt=Date.now();clearTimeout(pairTimer);local(msg);createRTC(true).catch(handleError);}
        else if(msg.type==='ping'){queue({type:'pong'});}
        else if(msg.type==='pong'){lastPong=Date.now();}
        else if(paired&&['offer','answer','ice'].includes(msg.type)){rtcSignal(msg);}
        else if(paired){local(msg);}
      }
      if(reassembly.size>40){for(const [key,val] of reassembly)if(Date.now()-val.at>120000)reassembly.delete(key);}
    }
    heartbeat=setInterval(()=>{if(connected&&room&&paired){if(Date.now()-pairedAt>30*60*1000){paired=false;pairedAt=0;resetRTC();if(isGlasses)startRoom(randomCode(),true,false).catch(handleError);else local({type:'disconnected'});return;}queue({type:'ping'});if(lastPong && Date.now()-lastPong>23000){paired=false;local({type:'disconnected'});}}},6000);
    async function sendStream(stream){if(isGlasses)throw Error('Only the computer can share a screen');desiredStream=stream;if(!paired)return;/* A fresh offer avoids renegotiation while an earlier data-only offer is pending. */await createRTC(true);}
    function send(msg){if(msg.type==='create'&&isGlasses){
      paired=false;lastPong=0;
      // Generate the pairing code locally, even when the public MQTT relay is down.
      // The user should never be stuck waiting for a network handshake to see a code.
      const pin=randomCode();
      code=pin;
      local({type:'room',code:pin,ready:false});
      if(connected)startRoom(pin,true,false).catch(handleError);
      return;
    }
      if(msg.type==='join'&&!isGlasses){desiredCode=(msg.code||'').toUpperCase();if(!connected)return;paired=false;lastPong=0;startRoom(desiredCode,false,false).catch(handleError);return;}
      if(!paired)return;
      if(!['offer','answer','ice','ping','pong','join','joined'].includes(msg.type)&&sendDirect(msg))return;
      queue(msg);
    }
    return {send,sendStream,get directReady(){return directReady;},close(){resetRTC();clearInterval(heartbeat);clearTimeout(pairTimer);wire.close();}};
  }
  return {connect,$};
})();