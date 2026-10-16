
import {clamp} from './core.js';
export function detectCandidates(data,record,settings){
 if(!data.monotonic)throw Error('Detection requires strictly increasing timestamps.');
 const group=record.display||data.entities.find(e=>e.type==='Bone')?.type+'|'+data.entities.find(e=>e.type==='Bone')?.group;
 let entities=data.entities.filter(e=>e.type+'|'+e.group===group);
 if(!entities.length)entities=data.entities;
 const wanted=settings.names||[];
 const chosen=wanted.length?entities.filter(e=>wanted.includes(e.name)):entities;
 if(!chosen.length)throw Error('Choose at least one available position channel.');
 const unit=record.unit||data.units;
 const scale=/millimeter|^mm$/i.test(unit)?0.001:/centimeter|^cm$/i.test(unit)?0.01:/meter|^m$/i.test(unit)?1:null;
 if(scale===null)throw Error('Choose the correct length unit before using speed thresholds.');
 const hip=settings.relative?entities.find(e=>e.name==='Hip'):null;
 if(settings.relative&&!hip)throw Error('Pelvis-relative detection requires an exported Hip position.');
 const n=data.frames.length,raw=Array(n).fill(null);
 for(let i=1;i<n;i++){
  const dt=data.times[i]-data.times[i-1];
  if(dt<=0||data.frames[i]!==data.frames[i-1]+1)continue;
  let sum=0,valid=true;
  for(const e of chosen){
   let ss=0;
   for(let a=0;a<3;a++){
    const u=e.positions[i*3+a],v=e.positions[(i-1)*3+a];
    const h=hip?hip.positions[i*3+a]:0,h0=hip?hip.positions[(i-1)*3+a]:0;
    if(![u,v,h,h0].every(Number.isFinite)){valid=false;break;}
    ss+=((u-h-v+h0)*scale/dt)**2;
   }
   if(!valid)break;sum+=Math.sqrt(ss);
  }
  if(valid)raw[i]=sum/chosen.length;
 }
 const smoothMs=Number(settings.smoothMs)||0,half=smoothMs/2000;
 // Only detection signal is smoothed. A window cannot bridge missing/invalid speeds.
 const speed=raw.map((v,i)=>{
  if(v===null||!half)return v;
  const w=[v];for(let k=i-1;k>=0&&data.times[i]-data.times[k]<=half;k--){if(raw[k]===null)break;w.push(raw[k]);}
  for(let k=i+1;k<n&&data.times[k]-data.times[i]<=half;k++){if(raw[k]===null)break;w.push(raw[k]);}
  w.sort((a,b)=>a-b);return w[Math.floor(w.length/2)];
 });
 const values=speed.filter(v=>v!==null).sort((a,b)=>a-b);
 if(values.length<5)throw Error('Not enough continuously tracked positions to detect candidates.');
 let threshold=settings.threshold===''||settings.threshold==null?values[Math.floor((values.length-1)*0.2)]:Number(settings.threshold);
 if(!Number.isFinite(threshold)||threshold<0)throw Error('Speed threshold must be a nonnegative value in m/s.');
 const stable=Math.max(0,Number(settings.stableMs))/1000,separation=Math.max(0,Number(settings.separationMs))/1000;
 const candidates=[];let start=null;
 const finish=end=>{
  if(start===null)return;
  const s=start;start=null;
  if(data.times[end]-data.times[s]<stable)return;
  let index=s;for(let k=s;k<=end;k++)if(speed[k]<speed[index])index=k;
  if(settings.preceding){
   let moved=false;for(let k=s-1;k>=0&&data.times[s]-data.times[k]<=0.8;k--){if(speed[k]===null)break;if(speed[k]>threshold*1.5){moved=true;break;}}
   if(!moved)return;
  }
  const candidate={index,start:s,end,speed:speed[index],stableSeconds:data.times[end]-data.times[s]};
  const previous=candidates.at(-1);
  if(previous&&data.times[index]-data.times[previous.index]<separation){if(candidate.speed<previous.speed)candidates[candidates.length-1]=candidate;}
  else candidates.push(candidate);
 };
 for(let i=0;i<n;i++){if(speed[i]!==null&&speed[i]<=threshold){if(start===null)start=i;}else finish(i-1);}
 finish(n-1);
 return {candidates,speed,settings:{...settings,threshold,channels:chosen.map(e=>e.full),unit:'m/s',method:'mean channel speed; optional window median; stable low-speed intervals',version:1},validSamples:values.length};
}
