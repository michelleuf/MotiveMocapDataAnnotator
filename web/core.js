
export const VERSION='0.1.0';
export const EDGES=[['Hip','Ab'],['Ab','Chest'],['Chest','Neck'],['Neck','Head'],['Chest','LShoulder'],['LShoulder','LUArm'],['LUArm','LFArm'],['LFArm','LHand'],['Chest','RShoulder'],['RShoulder','RUArm'],['RUArm','RFArm'],['RFArm','RHand'],['Hip','LThigh'],['LThigh','LShin'],['LShin','LFoot'],['LFoot','LToe'],['Hip','RThigh'],['RThigh','RShin'],['RShin','RFoot'],['RFoot','RToe']];
export const uid=()=>crypto.randomUUID();
export const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const cell=s=>/[",\r\n]/.test(String(s??''))?'"'+String(s).replaceAll('"','""')+'"':String(s??'');
export function csvRows(text){
 const rows=[];let fields=[],v='',quoted=false,start=0;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){v+='"';i++;}else if(quoted)quoted=false;else if(v===''||(start===0&&v==='\uFEFF'))quoted=true;else v+=c;}
  else if(c===','&&!quoted){fields.push(v);v='';}
  else if((c==='\r'||c==='\n')&&!quoted){
   fields.push(v);const eol=c==='\r'&&text[i+1]==='\n'?'\r\n':c;
   rows.push({fields,raw:text.slice(start,i),eol});
   if(eol.length===2)i++;start=i+1;fields=[];v='';
  }else v+=c;
 }
 if(quoted)throw Error('Unclosed quoted field in CSV. No data was loaded.');
 if(start<text.length){fields.push(v);rows.push({fields,raw:text.slice(start),eol:''});}
 return rows;
}
const norm=x=>String(x??'').replace(/^\uFEFF/,'').trim();
const numeric=x=>norm(x)===''?NaN:Number(x);
const fill=row=>{let last='';return row.map((x,i)=>{if(norm(x))last=norm(x);return i<2?norm(x):last;});};
export function parseMotive(text,name='recording.csv'){
 const rows=csvRows(text);const limit=Math.min(rows.length,80);
 const axis=rows.findIndex((r,i)=>i<limit&&norm(r.fields[0]).toLowerCase()==='frame'&&/time/i.test(r.fields[1]||''));
 if(axis<1)throw Error('Motive header not found. Export CSV with Frame, Time and Bone/Marker Position X/Y/Z channels.');
 let type=-1,component=-1;
 for(let i=0;i<axis;i++){
  if(rows[i].fields.some(x=>/^(Bone|Marker|Unlabeled Marker)$/i.test(norm(x))))type=i;
  if(rows[i].fields.some(x=>/^Position$/i.test(norm(x))))component=i;
 }
 if(type<0||component<0||type+1>=axis)throw Error('No Motive position-channel metadata found. Flat angle-only CSV is not supported.');
 const types=fill(rows[type].fields),names=fill(rows[type+1].fields),components=fill(rows[component].fields),axes=rows[axis].fields;
 const objects=new Map();
 for(let j=2;j<axes.length;j++){
  const a=norm(axes[j]).toUpperCase(),t=types[j],full=names[j];
  if(!['X','Y','Z'].includes(a)||!/^Position$/i.test(components[j]||'')||!/^(Bone|Marker|Unlabeled Marker)$/i.test(t||'')||!full)continue;
  const k=t+'|'+full;if(!objects.has(k))objects.set(k,{name:full.split(':').pop(),full,group:full.includes(':')?full.slice(0,full.lastIndexOf(':')):'Default',type:t,cols:{}});
  objects.get(k).cols[a]=j;
 }
 const channels=[...objects.values()].filter(o=>['X','Y','Z'].every(a=>a in o.cols));
 if(!channels.length)throw Error('No complete XYZ position channels found.');
 const metadata={};
 for(let i=0;i<type;i++){const f=rows[i].fields;for(let j=0;j+1<f.length;j+=2)if(norm(f[j]))metadata[norm(f[j])]=norm(f[j+1]);}
 const samples=[],warnings=[];let badRows=0,frameGaps=0,duplicates=0,nonmonotonic=0;
 const seen=new Set();
 for(let i=axis+1;i<rows.length;i++){
  const f=rows[i].fields;
  if(f.every(x=>!norm(x)))continue;
  const frame=numeric(f[0]),time=numeric(f[1]);
  if(!Number.isInteger(frame)||!Number.isFinite(time)){badRows++;continue;}
  if(seen.has(frame))duplicates++;seen.add(frame);
  if(samples.length){const prev=samples.at(-1);if(frame>prev.frame+1)frameGaps+=frame-prev.frame-1;if(time<=prev.time)nonmonotonic++;}
  samples.push({frame,time,row:i});
 }
 if(!samples.length)throw Error('No valid frame/time samples found.');
 let missing=0;
 const entities=channels.map(o=>{
  const positions=new Float32Array(samples.length*3);
  for(let i=0;i<samples.length;i++)for(let a=0;a<3;a++){const n=numeric(rows[samples[i].row].fields[o.cols['XYZ'[a]]]);positions[i*3+a]=Number.isFinite(n)?n:NaN;if(!Number.isFinite(n))missing++;}
  return {...o,positions};
 });
 if(badRows)warnings.push(badRows+' invalid frame/time rows retained in export, unavailable for annotation.');
 if(frameGaps)warnings.push(frameGaps+' missing source frame numbers; no samples invented.');
 if(duplicates)warnings.push(duplicates+' duplicate frame numbers; navigation uses sample indexes.');
 if(nonmonotonic)warnings.push(nonmonotonic+' non-increasing timestamps; playback disabled, exact sample stepping remains available.');
 if(missing)warnings.push(missing+' missing/non-finite coordinate values. No repair applied.');
 const units=metadata['Length Units']||metadata['Units']||'Unknown';
 const fps=Number(metadata['Export Frame Rate']||metadata['Capture Frame Rate'])||null;
 return {name,metadata,axis,frames:samples.map(s=>s.frame),times:samples.map(s=>s.time),sourceRows:samples.map(s=>s.row),raw:rows.map(r=>({raw:r.raw,eol:r.eol})),entities,warnings,units,fps,monotonic:nonmonotonic===0};
}
export function blankProject(){
 return {schema_version:2,app_version:VERSION,id:uid(),title:'Untitled motion project',created:new Date().toISOString(),labels:[{id:uid(),name:'Movement',color:'#50b8a5'},{id:uid(),name:'Terminal pose',color:'#e5b55d'}],recordings:[],annotations:[]};
}
export function makeAnnotation(recording,label,kind,start,end=start){
 return {id:uid(),recordingId:recording.id,labelId:label.id,kind,start:Math.min(start,end),end:kind==='point'?start:Math.max(start,end),sequence:'',side:'',category:'',notes:'',quality:'',status:'draft',created:new Date().toISOString(),updated:new Date().toISOString()};
}
export function validProject(p){
 if(!p||p.schema_version!==2||!Array.isArray(p.labels)||!Array.isArray(p.recordings)||!Array.isArray(p.annotations))throw Error('Unsupported project format. Use a version 2 web project or import a desktop version 1 project.');
 if(p.annotations.length>100000)throw Error('Project exceeds safety limits.');
 const ids=new Set();
 for(const l of p.labels){if(typeof l.id!=='string'||ids.has(l.id)||typeof l.name!=='string'||!l.name.trim()||/[;\r\n]/.test(l.name)||!/^#[0-9a-f]{6}$/i.test(l.color))throw Error('Invalid/duplicate label or color.');ids.add(l.id);}
 const records=new Map();
 for(const r of p.recordings){
  if(typeof r.id!=='string'||records.has(r.id)||typeof r.name!=='string'||!Array.isArray(r.frames)||!Array.isArray(r.times)||!r.frames.length||r.frames.length!==r.times.length||r.frames.some(n=>!Number.isInteger(n))||r.times.some(n=>!Number.isFinite(n)))throw Error('Invalid recording manifest.');
  if(!Array.isArray(r.connections)||r.connections.some(e=>!Array.isArray(e)||e.length!==2||e.some(n=>typeof n!=='string')))throw Error('Invalid connection map.');
  records.set(r.id,r);
 }
 const aids=new Set();
 for(const a of p.annotations){
  const r=records.get(a.recordingId);
  if(!r||!ids.has(a.labelId)||typeof a.id!=='string'||aids.has(a.id)||!['point','segment'].includes(a.kind)||!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<0||a.end<a.start||a.end>=r.frames.length||(a.kind==='point'&&a.start!==a.end))throw Error('Invalid annotation references or bounds.');
  for(const k of ['sequence','side','category','notes','quality','status'])if(typeof a[k]!=='string')throw Error('Invalid annotation fields.');
  aids.add(a.id);
 }
 return p;
}
export function annotationCSV(p,id){
 const r=p.recordings.find(x=>x.id===id);
 const head=['annotation_id','recording','participant','condition','source_state','kind','label','start_sample_index_0based','end_sample_index_0based_inclusive','start_source_frame','end_source_frame_inclusive','start_time_seconds','end_time_seconds','endpoint_elapsed_seconds','included_sample_count','sequence_id','side','category','notes','quality','review_status'];
 const values=p.annotations.filter(a=>a.recordingId===id).sort((a,b)=>a.start-b.start).map(a=>[a.id,r.name,r.participant||'',r.condition||'',r.state||'as-exported',a.kind,p.labels.find(l=>l.id===a.labelId)?.name||'',a.start,a.end,r.frames[a.start],r.frames[a.end],r.times[a.start],r.times[a.end],r.times[a.end]-r.times[a.start],a.end-a.start+1,a.sequence,a.side,a.category,a.notes,a.quality,a.status]);
 return [head,...values].map(row=>row.map(cell).join(',')).join('\r\n');
}
export function annotatedCSV(data,p,id){
 const perRow=new Map();const labels=new Map(p.labels.map(l=>[l.id,l.name]));
 for(const a of p.annotations.filter(a=>a.recordingId===id))for(let i=a.start;i<=a.end;i++){
  const source=data.sourceRows[i];if(!perRow.has(source))perRow.set(source,new Set());perRow.get(source).add(labels.get(a.labelId)||'');
 }
 return data.raw.map((r,i)=>r.raw+','+(i===data.axis?'Annotations':cell([...(perRow.get(i)||[])].join(';')))+r.eol).join('');
}
export function demoCSV(){
 const base={Hip:[0,1,0],Ab:[0,1.18,0],Chest:[0,1.4,0],Neck:[0,1.6,0],Head:[0,1.78,0],LShoulder:[.19,1.5,0],LUArm:[.31,1.43,0],LFArm:[.46,1.2,.08],LHand:[.49,1.05,.2],RShoulder:[-.19,1.5,0],RUArm:[-.31,1.43,0],RFArm:[-.46,1.2,.08],RHand:[-.49,1.05,.2],LThigh:[.12,.91,0],LShin:[.17,.5,.03],LFoot:[.2,.08,.05],LToe:[.2,.04,.22],RThigh:[-.12,.91,0],RShin:[-.17,.5,.03],RFoot:[-.2,.08,.05],RToe:[-.2,.04,.22]};
 const names=Object.keys(base),cols=names.length*3+2;
 const row=x=>[...x,...Array(Math.max(0,cols-x.length)).fill('')];
 const meta=['Format Version','1.23','Capture Frame Rate','240','Export Frame Rate','240','Length Units','Meters'];
 const rows=[row(meta),row([]),['','',...names.flatMap(()=>['Bone','Bone','Bone'])],['','',...names.flatMap(n=>['Demo:'+n,'Demo:'+n,'Demo:'+n])],['','',...names.flatMap((n,i)=>[i,i,i])],['','',...names.flatMap(()=>['Position','Position','Position'])],['Frame','Time (Seconds)',...names.flatMap(()=>['X','Y','Z'])]];
 for(let i=0;i<1440;i++){
  const t=i/240,phase=Math.sin(t*Math.PI*1.1),turn=.4*Math.sin(t*.7),x=.25*Math.sin(t*.6);
  rows.push([1000+i,t.toFixed(8),...names.flatMap(n=>{
   let [a,b,c]=base[n];if(n==='LHand'||n==='LFArm'){b+=.26*Math.max(0,phase);c+=.44*Math.max(0,phase);}
   if(n==='LFoot'||n==='LToe'||n==='LShin'){b+=.35*Math.max(0,-phase);c+=.6*Math.max(0,-phase);}
   return [a*Math.cos(turn)+c*Math.sin(turn)+x,b,c*Math.cos(turn)-a*Math.sin(turn)].map(v=>v.toFixed(6));
  })]);
 }
 return rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
