'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const {TextEncoder,TextDecoder}=require('node:util');

const source=fs.readFileSync(require('node:path').resolve(__dirname,'../shared.js'),'utf8');

function varlen(n){
  const a=[];
  do{let b=n%128;n=Math.floor(n/128);if(n>0)b|=128;a.push(b)}while(n>0);
  return Buffer.from(a);
}
function packet(type,body){
  const b=Buffer.from(body||[]);
  return Buffer.concat([Buffer.from([type]),varlen(b.length),b]);
}
function stringField(s){
  const b=Buffer.from(s,'utf8');
  return Buffer.concat([Buffer.from([b.length>>8,b.length&255]),b]);
}
function decodePacket(raw){
  const b=Buffer.from(raw);
  let i=1,n=0,mult=1,d;
  do{d=b[i++];n+=(d&127)*mult;mult*=128}while(d&128);
  return {type:b[0]>>4,payload:b.subarray(i,i+n)};
}
function readString(b,offset){
  const n=b.readUInt16BE(offset);
  return {value:b.subarray(offset+2,offset+2+n).toString('utf8'),next:offset+2+n};
}
function mockBroker(opts={}){
  const peers=new Set();
  let dropped=false;
  class Socket{
    static OPEN=1;
    constructor(url,protocol){
      this.url=url;this.protocol=protocol;
      this.readyState=0;this.subscriptions=new Set();
      peers.add(this);
      setImmediate(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.()});
    }
    send(raw){
      const {type,payload}=decodePacket(raw);
      if(type===1){
        setImmediate(()=>this._deliver(packet(0x20,[0,0])));
      }else if(type===8){
        const pid=payload.subarray(0,2);
        const {value}=readString(payload,2);
        this.subscriptions.add(value);
        setImmediate(()=>this._deliver(packet(0x90,Buffer.concat([pid,Buffer.from([0])]))));
      }else if(type===3){
        const {value,next}=readString(payload,0);
        if(opts.dropFirstJoin && !dropped && value.endsWith('/glasses')){
          dropped=true;
          return;
        }
        const data=payload.subarray(next);
        for(const p of peers){
          if(p.readyState===1 && p.subscriptions.has(value)){
            const outgoing=packet(0x30,Buffer.concat([stringField(value),data]));
            setImmediate(()=>p._deliver(outgoing));
          }
        }
      }else if(type===10){
        const {value}=readString(payload,2);this.subscriptions.delete(value);
      }
    }
    _deliver(b){
      if(this.readyState!==1)return;
      const bytes=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
      this.onmessage?.({data:bytes});
    }
    close(){this.readyState=3;this.onclose?.({});peers.delete(this);}
  }
  return {Socket,wasJoinDropped:()=>dropped};
}
function client(Socket,role){
  const messages=[],states=[];
  const context=vm.createContext({
    crypto:webcrypto,TextEncoder,TextDecoder,WebSocket:Socket,Blob,
    setInterval,clearInterval,setTimeout,clearTimeout,
    location:{pathname:role==='glasses'?'/meta-browser/glasses.html':'/meta-browser/computer.html'},
    console
  });
  vm.runInContext(source+';globalThis.exportedVisor=VISOR;',context);
  const api=context.exportedVisor.connect(m=>messages.push(m),s=>states.push(s),{role});
  return {api,messages,states,close:()=>api.close()};
}
async function waitFor(predicate,ms=5000){
  const end=Date.now()+ms;
  while(Date.now()<end){
    if(predicate())return;
    await new Promise(r=>setTimeout(r,30));
  }
  assert.fail('Timed out waiting for expected pairing event');
}
async function pairingScenario(dropFirstJoin){
  const broker=mockBroker({dropFirstJoin});
  const glasses=client(broker.Socket,'glasses');
  const computer=client(broker.Socket,'computer');
  try{
    glasses.api.send({type:'create'});
    const created=glasses.messages.find(m=>m.type==='room');
    assert.match(created.code,/^[A-HJ-NP-Z2-9]{12}$/);
    assert.equal(created.ready,false,'code should appear before broker login');
    await waitFor(()=>glasses.messages.some(m=>m.type==='room'&&m.ready));
    await waitFor(()=>computer.states.includes('online'));
    computer.api.send({type:'join',code:created.code});
    await waitFor(()=>computer.messages.some(m=>m.type==='joined'),8000);
    await waitFor(()=>glasses.messages.some(m=>m.type==='paired'));
    assert.ok(computer.messages.some(m=>m.type==='pair_status'&&m.phase==='joining'));
    if(dropFirstJoin)assert.equal(broker.wasJoinDropped(),true);
  }finally{
    computer.close();glasses.close();
  }
}
test('12-character code appears immediately and pair succeeds through MQTT',async()=>pairingScenario(false));
test('lost first JOIN is automatically retried and acknowledged',async()=>pairingScenario(true));
