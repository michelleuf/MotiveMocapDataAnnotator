
import {VERSION,EDGES,uid,clamp,esc,cell,parseMotive,blankProject,makeAnnotation,validProject,annotationCSV,annotatedCSV,demoCSV} from './core.js';
import {MotionViewer} from './viewer.js';
import {Timeline} from './timeline.js';
import {detectCandidates} from './detector.js';
const $=id=>document.getElementById(id),dataById=new Map(),sourceByHash=new Map();let project=blankProject(),active=null,index=0,selected=null,activeLabel=project.labels[0].id,dirty=false,playing=false,pending=null,looping=null,undo=[],redo=[],preview=null,recovery=null,viewer;
$('appVersion').textContent='MOCAP ANNOTATION WORKSPACE · v'+VERSION;
const record=()=>project.recordings.find(r=>r.id===active),data=()=>dataById.get(active),annotation=()=>project.annotations.find(a=>a.id===selected);
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
const run=fn=>async(...args)=>{try{return await fn(...args);}catch(e){console.error(e);notice(e.message||String(e),true);}};
const on=(id,type,fn)=>$(id).addEventListener(type,run(fn));
function ask(title,html,ok='Continue'){
 return new Promise(resolve=>{
  const dialog=$('modal');$('modalBody').innerHTML='<h2>'+esc(title)+'</h2>'+html;$('modalOK').textContent=ok;$('modalCancel').hidden=false;
  const finish=value=>{dialog.close();resolve(value);};
  $('modalForm').onsubmit=e=>{e.preventDefault();finish(Object.fromEntries(new FormData(e.currentTarget)));};
  $('modalCancel').onclick=()=>finish(null);dialog.oncancel=e=>{e.preventDefault();finish(null);};dialog.showModal();
 });
}
function download(content,name,type){
 const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function snapshot(){return JSON.stringify(project);}
function edit(fn){undo.push(snapshot());if(undo.length>70)undo.shift();redo=[];fn();dirty=true;project.updated=new Date().toISOString();scheduleRecovery();render();}
let saveTimer;function scheduleRecovery(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveRecovery().catch(e=>{notice('Recovery unavailable: '+e.message+'. Download your project.',true);}),350);}
const database=new Promise((resolve,reject)=>{const q=indexedDB.open('motion-studio',1);q.onupgradeneeded=()=>q.result.createObjectStore('recovery');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
async function saveRecovery(){const db=await database;const p=structuredClone(project);p.currentRecording=active;p.currentIndex=index;await new Promise((resolve,reject)=>{const t=db.transaction('recovery','readwrite');t.objectStore('recovery').put(p,'project');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});$('saveState').textContent=(dirty?'Unsaved changes · ':'')+'Recovery saved locally';}
database.then(db=>{const q=db.transaction('recovery').objectStore('recovery').get('project');q.onsuccess=()=>{if(q.result){recovery=q.result;$('recoverBar').hidden=false;}};}).catch(()=>notice('Local recovery is unavailable. Save project downloads regularly.',true));
function saveProject(){project.currentRecording=active;project.currentIndex=index;download(JSON.stringify(project,null,2),safeName(project.title)+'.mocapproj','application/json');dirty=false;render();scheduleRecovery();notice('Project downloaded. Keep this file and your original CSVs together.');}
const safeName=s=>String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100)||'motion_project';
async function ensureLeave(){
 if(!dirty)return true;
 const a=await ask('Keep your annotation changes?','<p>Save a portable project before continuing. Browser recovery is a separate convenience.</p><label><input type="radio" name="choice" value="save" checked> Save project & continue</label><label><input type="radio" name="choice" value="discard"> Continue without downloading</label>','Continue');
 if(!a)return false;if(a.choice==='save')saveProject();return true;
}
function switchRecord(id){
 stop();active=id;if(record()){const cached=sourceByHash.get(record().hash);if(cached)dataById.set(id,cached);else dataById.delete(id);}index=clamp(project.currentRecording===id?project.currentIndex||0:0,0,(record()?.frames.length||1)-1);selected=null;pending=null;looping=null;timeline.fit();
 const d=data();$('emptyViewer').hidden=!!d;viewer?.set(d||null,record());syncRecordSettings();render();
}
function seek(n){const r=record();if(!r)return;index=clamp(Math.round(n),0,r.frames.length-1);viewer?.frame(index);renderPosition();}
let clockToken=0;function stop(){clockToken++;playing=false;$('play').textContent='▶';}
function renderPosition(){
 const r=record();$('time').textContent=r?r.times[index].toFixed(4)+' s':'0.0000 s';$('sampleReadout').textContent=r?'Sample '+(index+1)+' / '+r.frames.length:'No recording';$('jumpFrame').value=r?r.frames[index]:'';
 if(r){const here=project.annotations.filter(a=>a.recordingId===active&&a.start<=index&&a.end>=index);$('tracking').textContent=data()?(viewer?.visible??0)+' visible positions · '+here.length+' active labels':'CSV needs relinking';}
 timeline.update({project,record:r,index,selection:selected,activeLabel});
}
function render(){
 if(!project.labels.some(l=>l.id===activeLabel))activeLabel=project.labels[0]?.id;
 $('projectTitle').textContent=project.title;$('recordCount').textContent=project.recordings.length;
 $('saveState').textContent=dirty?'● Unsaved changes':'Project changes saved';
 $('recordList').innerHTML=project.recordings.map(r=>'<button class="record-item '+(r.id===active?'active':'')+'" data-record="'+esc(r.id)+'"><span class="file-icon">▤</span><span><strong>'+esc(r.name)+'</strong><small>'+r.frames.length.toLocaleString()+' samples · '+(dataById.has(r.id)?(r.synthetic?'synthetic':'ready'):'relink CSV')+'</small></span></button>').join('');
 $('recordName').textContent=record()?.name||'Your movement, frame by frame.';
 $('labelList').innerHTML=project.labels.map(l=>'<div class="label-item '+(l.id===activeLabel?'active':'')+'"><button data-label="'+esc(l.id)+'"><i class="label-dot" style="background:'+l.color+'"></i>'+esc(l.name)+'</button><span class="label-tools"><button class="edit-label" data-label-edit="'+esc(l.id)+'" title="Rename label and change color">Edit</button><button class="delete-label" data-label-delete="'+esc(l.id)+'" title="Delete label">Delete</button></span></div>').join('');
 $('editLabel').innerHTML=project.labels.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.name)+'</option>').join('');
 $('pendingStart').textContent=pending!==null?'Start set at frame '+record().frames[pending]+'. Move to the end and press O.':'Select a label, then mark a pose or interval.';
 const query=$('search').value.toLowerCase(),anns=project.annotations.filter(a=>a.recordingId===active).sort((a,b)=>a.start-b.start),r=record();
 const shown=anns.filter(a=>[project.labels.find(l=>l.id===a.labelId)?.name,a.sequence,a.notes,a.category].join(' ').toLowerCase().includes(query));
 $('annotationCount').textContent=anns.length+' annotations';const ns=anns.filter(a=>a.status==='suggested').length;$('suggestionCount').textContent=ns?'· '+ns+' pending suggestions':'';
 $('annotationRows').innerHTML=shown.map(a=>{const l=project.labels.find(l=>l.id===a.labelId);return '<tr data-annotation="'+esc(a.id)+'" class="'+(a.id===selected?'selected':'')+'"><td><i class="label-dot" style="background:'+l.color+'"></i>'+esc(l.name)+'</td><td>'+a.kind+'</td><td>'+r.frames[a.start]+'</td><td>'+r.frames[a.end]+'</td><td>'+(r.times[a.end]-r.times[a.start]).toFixed(4)+' s</td><td>'+esc(a.sequence||'—')+'</td><td><span class="badge '+(a.status==='suggested'?'suggested':a.status==='reviewed'?'reviewed':'')+'">'+esc(a.status)+'</span></td><td>'+(a.status==='suggested'?'<button data-review="'+esc(a.id)+'">Review ✓</button>':'')+'</td></tr>';}).join('');
 $('emptyTable').hidden=shown.length>0;fillEditor();$('undo').disabled=!undo.length;$('redo').disabled=!redo.length;
 for(const id of ['play','prev','next','first','last','backN','forwardN','setStart','setEnd','markPose','semiMode','exportMotive','exportTable'])$(id).disabled=!r||!data();
 for(const id of ['setStart','setEnd','markPose','semiMode'])$(id).disabled=!r||!data()||!activeLabel;
 renderPosition();
}
function fillEditor(){
 const a=annotation(),r=record();$('noSelection').hidden=!!a;$('annotationFields').hidden=!a;if(!a)return;
 $('editLabel').value=a.labelId;$('editStart').value=r.frames[a.start];$('editEnd').value=r.frames[a.end];$('editEnd').disabled=a.kind==='point';
 for(const [id,key] of [['editSequence','sequence'],['editSide','side'],['editCategory','category'],['editNotes','notes'],['editQuality','quality'],['editStatus','status']])$(id).value=a[key]||'';
 $('annotationProvenance').textContent=a.origin==='detector'?'Suggested from motion speed · '+Number(a.detector.threshold).toFixed(4)+' m/s · settings stored in project.':'Manually annotated · inclusive source-frame bounds.';
}
function syncRecordSettings(){
 const r=record(),d=data();for(const [id,key] of [['participant','participant'],['condition','condition'],['sourceState','state'],['upAxis','up']])$(id).value=r?.[key]||({sourceState:'as-exported',upAxis:'Y'}[id]||'');
 $('positionGroup').innerHTML=d?(viewer?.choices(d)||[]).map(c=>'<option value="'+esc(c.key)+'">'+esc(c.name)+'</option>').join(''):'';
 if(r&&d)$('positionGroup').value=r.display||(viewer?.choices(d)||[])[0]?.key;
 $('units').value=r?.unit||'Unknown';$('connections').value=(r?.connections||[]).map(e=>e.join(',')).join('\n');
}
function selectAnnotation(id){stop();selected=id;const a=annotation();if(a)seek(a.start);render();}
function addAnnotation(labelId,start,end,kind='segment'){
 if(!record()||!data())return;stop();const l=project.labels.find(l=>l.id===labelId);if(!l)throw Error('Choose a label first.');
 const a=makeAnnotation(record(),l,kind,start,end);a.origin='manual';edit(()=>project.annotations.push(a));selected=a.id;render();
}
function changeBounds(id,start,end){const a=project.annotations.find(a=>a.id===id);if(!a)return;edit(()=>{a.start=start;a.end=a.kind==='point'?start:end;a.updated=new Date().toISOString();if(a.status==='suggested')a.status='draft';});}
const timeline=new Timeline($('timeline'),{seek:n=>{stop();seek(n);},select:selectAnnotation,create:(l,s,e)=>addAnnotation(l,s,e),edit:changeBounds,panChanged:f=>{$('pan').value=Math.round(f*1000);}});
try{viewer=new MotionViewer($('viewer'),name=>notice('Selected position: '+name));}catch(e){notice('3D rendering unavailable: '+e.message+'. Try a browser with WebGL enabled.',true);}

async function readCSV(file){
 if(file.size>180*1024*1024)throw Error('This first version limits each CSV to 180 MB. Use a shorter export or contact the developer.');
 const bytes=await file.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const text=new TextDecoder('utf-8',{ignoreBOM:true,fatal:true}).decode(bytes);
 const parsed=await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./parser-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=e=>{worker.terminate();e.data.error?reject(Error(e.data.error)):resolve(e.data.data);};worker.onerror=e=>{worker.terminate();reject(Error(e.message||'CSV parser failed.'));};
  worker.postMessage({text,name:file.name});
 });return {parsed,hash};
}
async function loadFiles(files,relink=false){
 if(relink&&files.length!==1)throw Error('Select one CSV to relink.');
 for(const file of files){
  stop();notice('Reading '+file.name+' locally…');
  const {parsed:d,hash}=await readCSV(file);sourceByHash.set(hash,d);
  if(relink){
   const r=record();if(!r)throw Error('Select a recording before relinking.');
   const same=r.frames.length===d.frames.length&&r.frames.every((n,i)=>n===d.frames[i]&&Math.abs(r.times[i]-d.times[i])<1e-9);
   if(!same)throw Error('Frame/time mapping changed. This CSV cannot replace the recording without remapping annotations.');
   if(hash!==r.hash){
    const yes=await ask('Use this replacement CSV?','<p>Every frame number and timestamp matches, but the file content differs. Existing annotations will be retained. Verify the participant, condition and trial yourself.</p><label>Source state<select name="state"><option value="processed">Processed</option><option value="as-exported">As exported</option></select></label>','Use replacement');
    if(!yes)return;
    edit(()=>{r.previousSources=[...(r.previousSources||[]),{hash:r.hash,name:r.name,state:r.state}];r.hash=hash;r.name=file.name;r.state=yes.state;});
   }
   dataById.set(r.id,d);switchRecord(r.id);notice('Source linked. '+d.warnings.join(' '));continue;
  }
  const existing=project.recordings.find(r=>r.hash===hash);
  if(existing){dataById.set(existing.id,d);switchRecord(existing.id);notice('Matching CSV relinked. '+d.warnings.join(' '));continue;}
  const chosen=d.entities.find(e=>e.type==='Bone')||d.entities[0],knownUnit=/^meter|^centimeter|^millimeter$/i.test(d.units)?d.units:'Unknown';
  const r={id:uid(),name:file.name,hash,frames:d.frames,times:d.times,participant:'',condition:'',state:'as-exported',unit:knownUnit,up:'Y',display:chosen.type+'|'+chosen.group,connections:[],imported:new Date().toISOString(),synthetic:file.name==='SYNTHETIC_DEMO.csv'};
  const legacy=project.legacyPending?.find(l=>l.name.toLowerCase()===file.name.toLowerCase());
  const migrated=[];
  if(legacy)for(const old of legacy.annotations){
   if(!Number.isInteger(old.start)||!Number.isInteger(old.end)||old.start<0||old.end<old.start||old.end>=d.frames.length)throw Error('Legacy annotation bounds do not fit this CSV. Original project remains untouched.');
   const l=project.labels.find(l=>l.name===old.label);if(!l)throw Error('Legacy label missing: '+old.label);
   const a=makeAnnotation(r,l,'segment',old.start,old.end);a.notes=(old.notes||'')+(old.start===old.end?' [Legacy one-sample interval: confirm whether this is a terminal point.]':'');a.origin='legacy';migrated.push(a);
  }
  dataById.set(r.id,d);edit(()=>{project.recordings.push(r);project.annotations.push(...migrated);if(legacy)project.legacyPending=project.legacyPending.filter(l=>l!==legacy);});switchRecord(r.id);
  notice((r.synthetic?'Synthetic demo. Not participant data. ':'Imported '+d.frames.length.toLocaleString()+' samples. ')+(d.warnings.join(' ')||'Check units, axes and position mapping before annotation.'));
 }
}
async function loadProject(p){
 if(p?.version===1&&p.annotations&&p.labels){
  const next=blankProject();next.title='Imported desktop project';
  next.labels=p.labels.map(l=>({id:uid(),name:l.name,color:l.color||'#50b8a5'}));
  if(!next.labels.length)throw Error('Legacy project has no labels.');
  next.legacyPending=Object.entries(p.annotations).map(([path,annotations])=>({name:path.split(/[\\/]/).pop(),annotations}));
  if(!await ensureLeave())return;project=next;dataById.clear();sourceByHash.clear();activeLabel=next.labels[0].id;active=null;selected=null;dirty=true;undo=[];redo=[];switchRecord(null);scheduleRecovery();notice('Desktop project labels loaded. Open its original CSVs to migrate annotations by exact row indexes. One-sample intervals need review.');return;
 }
 validProject(p);
 if(!await ensureLeave())return;
 project=structuredClone(p);dataById.clear();sourceByHash.clear();activeLabel=project.labels[0]?.id;active=project.currentRecording||project.recordings[0]?.id||null;dirty=false;undo=[];redo=[];switchRecord(active);scheduleRecovery();notice('Project restored. Open its original CSVs to relink them by file fingerprint.');
}
function exportable(){
 const p=structuredClone(project);
 if(!$('includeSuggested').checked)p.annotations=p.annotations.filter(a=>a.status!=='suggested');
 return p;
}
function needRecord(){if(!record()||!data())throw Error('Open or relink a Motive CSV first.');}
function frameIndex(value){
 const r=record(),n=Number(value),hits=[];r.frames.forEach((f,i)=>{if(f===n)hits.push(i);});
 if(hits.length!==1)throw Error(hits.length?'Source frame is duplicated. Use exact sample dragging on the timeline.':'That source frame is not present. No frame was invented.');
 return hits[0];
}
function navigateAnnotation(direction){
 const list=project.annotations.filter(a=>a.recordingId===active).sort((a,b)=>a.start-b.start);
 const current=list.findIndex(a=>a.id===selected),a=list[clamp(current+direction,0,list.length-1)];if(a)selectAnnotation(a.id);
}
function startPlayback(loop=null){
 needRecord();if(!data().monotonic)throw Error('Non-increasing timestamps: use exact sample stepping instead.');
 if(playing&&!loop){stop();return;}looping=loop;
 const r=record();if(index>=r.frames.length-1)seek(loop?.start||0);
 if(loop)seek(loop.start);playing=true;$('play').textContent='Ⅱ';
 const token=++clockToken;let last=performance.now(),target=r.times[index];
 function tick(now){
  if(!playing||token!==clockToken)return;
  const rr=record();target+=(now-last)/1000*Number($('speed').value);last=now;
  const end=looping?.end??rr.frames.length-1;
  if(target>=rr.times[end]){if(looping){target=rr.times[looping.start];seek(looping.start);}else{seek(end);stop();return;}}
  let lo=index,hi=end;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(rr.times[mid]<=target)lo=mid;else hi=mid-1;}
  if(lo!==index)seek(lo);requestAnimationFrame(tick);
 }
 requestAnimationFrame(tick);
}
on('csvInput','change',async e=>{try{await loadFiles([...e.target.files]);}finally{e.target.value='';}});
on('relinkInput','change',async e=>{try{await loadFiles([...e.target.files],true);}finally{e.target.value='';}});
on('projectInput','change',async e=>{try{const f=e.target.files[0];if(f)await loadProject(JSON.parse(await f.text()));}finally{e.target.value='';}});
for(const id of ['addCSV','emptyOpen'])on(id,'click',()=>$('csvInput').click());
for(const id of ['demo','emptyDemo'])on(id,'click',()=>loadFiles([new File([demoCSV()],'SYNTHETIC_DEMO.csv',{type:'text/csv'})]));
on('restoreSource','click',()=>{needRecordManifest();$('relinkInput').click();});
function needRecordManifest(){if(!record())throw Error('Select a recording first.');}
on('openProject','click',()=>$('projectInput').click());on('saveProject','click',saveProject);
on('recover','click',async()=>{if(recovery){await loadProject(recovery);$('recoverBar').hidden=true;}});
on('newProject','click',async()=>{if(!await ensureLeave())return;stop();project=blankProject();dataById.clear();sourceByHash.clear();activeLabel=project.labels[0].id;active=null;selected=null;dirty=false;undo=[];redo=[];switchRecord(null);scheduleRecovery();notice('New local project.');});
on('projectTitle','click',async()=>{const a=await ask('Name your project','<label>Project title<input name="title" required maxlength="120" value="'+esc(project.title)+'"></label>','Save name');if(a)edit(()=>project.title=a.title.trim()||'Untitled motion project');});
on('recordList','click',async e=>{const id=e.target.closest('[data-record]')?.dataset.record;if(id&&id!==active){if(await ensureLeave())switchRecord(id);}});
on('labelList','click',async e=>{
 const choose=e.target.closest('[data-label]');if(choose){activeLabel=choose.dataset.label;render();return;}
 const remove=e.target.closest('[data-label-delete]');
 if(remove){await deleteLabel(remove.dataset.labelDelete);return;}
 const id=e.target.closest('[data-label-edit]')?.dataset.labelEdit;if(!id)return;
 const l=project.labels.find(l=>l.id===id),count=project.annotations.filter(a=>a.labelId===id).length;
 const a=await ask('Rename label','<p>Renaming this reusable label updates all '+count+' annotations that use it, across all recordings.</p><label>Name<input name="name" value="'+esc(l.name)+'" required maxlength="70"></label><label>Color<input name="color" type="color" value="'+l.color+'"></label>','Save label');
 if(!a)return;checkLabel(a.name,id);edit(()=>{l.name=a.name.trim();l.color=a.color;});notice('Label renamed. Existing annotations now display the new name.');
});
async function deleteLabel(id){
 const l=project.labels.find(l=>l.id===id);if(!l)return;
 const count=project.annotations.filter(a=>a.labelId===id).length,others=project.labels.filter(x=>x.id!==id),wasActive=activeLabel===id;
 const options=others.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
 const choices=count?(others.length?'<label><input type="radio" name="action" value="reassign" checked> Keep annotations and change their label</label><label>Replacement label<select name="replacement">'+options+'</select></label>':'<p>Create another label first if you want to keep these annotations.</p>')+'<label><input type="radio" name="action" value="remove" '+(!others.length?'checked':'')+'> Delete the '+count+' annotations using this label</label>':'<p>No annotations use this label.</p>';
 const a=await ask('Delete “'+l.name+'”?','<p>This label is used by <b>'+count+'</b> annotations across the project.</p>'+choices+'<p>You can undo this change.</p>','Delete label');
 if(!a)return;
 if(count&&a.action==='reassign'&&!others.some(x=>x.id===a.replacement))throw Error('Choose another label before deleting.');
 edit(()=>{
  if(count&&a.action==='reassign')for(const item of project.annotations.filter(x=>x.labelId===id)){
   item.labelId=a.replacement;item.updated=new Date().toISOString();if(item.status==='suggested')item.status='draft';
  }
  else if(count)project.annotations=project.annotations.filter(x=>x.labelId!==id);
  project.labels=project.labels.filter(x=>x.id!==id);
 });
 if(wasActive)activeLabel=a.action==='reassign'?a.replacement:project.labels[0]?.id;
 if(!project.annotations.some(x=>x.id===selected))selected=null;
 render();notice('Label deleted'+(count?(a.action==='reassign'?'; '+count+' annotations reassigned':'; '+count+' annotations deleted'):'')+'. Undo is available.');
}
function checkLabel(name,id){
 if(!name.trim()||/[;\r\n]/.test(name))throw Error('Use a nonempty label without semicolons or line breaks (semicolons separate labels in CSV export).');
 if(name.trim().length>70)throw Error('Keep each label name within 70 characters.');
 if(project.labels.some(l=>l.id!==id&&l.name.toLowerCase()===name.trim().toLowerCase()))throw Error('A label with that name already exists.');
}
on('newLabel','click',async()=>{
 const a=await ask('Create labels','<label>Label names — one per line<textarea name="names" rows="6" placeholder="Kick&#10;Stance&#10;Left punch" required></textarea></label><label>Color (you can change each later)<input name="color" type="color" value="#8ca3d7"></label>','Add labels');
 if(!a)return;const names=a.names.split(/\r?\n/).map(n=>n.trim()).filter(Boolean);
 if(!names.length)throw Error('Enter at least one label name.');
 const seen=new Set();for(const name of names){checkLabel(name);const key=name.toLowerCase();if(seen.has(key))throw Error('Duplicate label in this list: '+name);seen.add(key);}
 const labels=names.map(name=>({id:uid(),name,color:a.color}));edit(()=>project.labels.push(...labels));activeLabel=labels[0].id;render();notice('Added '+labels.length+' reusable labels. Select an existing annotation to change its label.');
});
on('first','click',()=>{stop();seek(0);});on('last','click',()=>{stop();seek(record().frames.length-1);});
on('prev','click',()=>{stop();seek(index-1);});on('next','click',()=>{stop();seek(index+1);});
const stepN=()=>Math.max(1,Math.round(Number($('stepN').value)||1));
on('backN','click',()=>{stop();seek(index-stepN());});on('forwardN','click',()=>{stop();seek(index+stepN());});on('play','click',()=>startPlayback());
on('jumpForm','submit',e=>{e.preventDefault();needRecord();stop();seek(frameIndex($('jumpFrame').value));});
on('setStart','click',()=>{needRecord();stop();pending=index;render();});
on('setEnd','click',()=>{needRecord();if(pending===null)throw Error('Set a start first (I).');const s=pending;pending=null;addAnnotation(activeLabel,s,index);});
on('markPose','click',()=>{needRecord();addAnnotation(activeLabel,index,index,'point');});
on('annotationRows','click',e=>{
 const accept=e.target.closest('[data-review]');if(accept){selected=accept.dataset.review;reviewSelected();return;}
 const row=e.target.closest('[data-annotation]');if(row)selectAnnotation(row.dataset.annotation);
});
function reviewSelected(){const a=annotation();if(a)edit(()=>{a.status='reviewed';a.updated=new Date().toISOString();});}
on('acceptSelected','click',reviewSelected);
on('editor','submit',e=>{
 e.preventDefault();const a=annotation();if(!a)return;const start=frameIndex($('editStart').value),end=a.kind==='point'?start:frameIndex($('editEnd').value);if(end<start)throw Error('End must follow start.');
 const changedLabel=a.labelId!==$('editLabel').value;
 edit(()=>{Object.assign(a,{start,end,labelId:$('editLabel').value,sequence:$('editSequence').value,side:$('editSide').value,status:$('editStatus').value,category:$('editCategory').value,notes:$('editNotes').value,quality:$('editQuality').value,updated:new Date().toISOString()});if(changedLabel&&a.status==='suggested')a.status='draft';});
});
on('deleteAnnotation','click',()=>{if(!annotation())return;edit(()=>project.annotations=project.annotations.filter(a=>a.id!==selected));selected=null;render();});
on('loop','click',()=>{const a=annotation();if(a&&a.end>a.start)startPlayback(a);else notice('Select a segment spanning more than one sample.');});
on('search','input',render);
on('undo','click',()=>{if(!undo.length)return;stop();redo.push(snapshot());project=JSON.parse(undo.pop());if(!record())active=project.recordings[0]?.id||null;selected=null;dirty=true;switchRecord(active);scheduleRecovery();});
on('redo','click',()=>{if(!redo.length)return;stop();undo.push(snapshot());project=JSON.parse(redo.pop());if(!record())active=project.recordings[0]?.id||null;selected=null;dirty=true;switchRecord(active);scheduleRecovery();});
on('zoomIn','click',()=>timeline.changeZoom(1.6));on('zoomOut','click',()=>timeline.changeZoom(1/1.6));on('zoomFit','click',()=>timeline.fit());on('pan','input',e=>timeline.pan(Number(e.target.value)/1000));
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{if(b.id==='fitView')viewer?.fit();else viewer?.preset(b.dataset.view);}));
on('showNames','change',()=>{if(viewer){viewer.names=$('showNames').checked;viewer.render();}});
on('applyDisplay','click',()=>{
 needRecord();const r=record(),connections=$('connections').value.split('\n').filter(x=>x.trim()).map(line=>line.split(',').map(s=>s.trim()));
 if(connections.some(e=>e.length!==2||e.some(n=>!n)))throw Error('Each connection needs two names separated by a comma.');
 edit(()=>{Object.assign(r,{participant:$('participant').value.trim(),condition:$('condition').value.trim(),state:$('sourceState').value,display:$('positionGroup').value,unit:$('units').value,up:$('upAxis').value,connections});});
 viewer?.set(data(),r);seek(index);if(r.participant.toUpperCase()==='E1')notice('E1 is Michelle and must remain excluded from HMD study analyses. Source files are preserved.',true);
});
on('diagnostics','click',async()=>{
 needRecord();const d=data(),r=record(),report=['File: '+r.name,'Samples: '+r.frames.length,'Original frames: '+r.frames[0]+' → '+r.frames.at(-1),'Time: '+r.times[0]+' → '+r.times.at(-1)+' seconds','Declared rate: '+(d.fps||'not supplied')+' Hz','Length units: '+d.units,'Position groups: '+(viewer?.choices(d)||[]).map(c=>c.name).join(', '),'Shown group: '+r.display,'SHA-256: '+r.hash,'','Warnings:',...(d.warnings.length?d.warnings:['None detected. This is not a biomechanical validation.'])].join('\n');
 await ask('Import report','<pre class="report">'+esc(report)+'</pre>','Close');
});
on('exportMotive','click',()=>{needRecord();const r=record(),p=exportable();download(annotatedCSV(data(),p,active),safeName(r.name.replace(/\.csv$/i,''))+'_ANNOTATED.csv','text/csv;charset=utf-8');notice('New annotated CSV downloaded. Original records retained; pending suggestions '+($('includeSuggested').checked?'included explicitly.':'excluded.'));});
on('exportTable','click',()=>{needRecord();download(annotationCSV(exportable(),active),safeName(record().name.replace(/\.csv$/i,''))+'_annotations.csv','text/csv;charset=utf-8');notice('Annotation table downloaded. Start/end samples are inclusive; elapsed time is the endpoint timestamp difference.');});

function openAssist(){
 needRecord();if(!project.labels.length)throw Error('Create a label first.');stop();$('semiMode').classList.add('active');$('manualMode').classList.remove('active');
 const r=record(),d=data(),objects=d.entities.filter(e=>e.type+'|'+e.group===r.display),defaults=['LHand','RHand','LFoot','RFoot'];
 $('detectChannels').innerHTML=objects.map(e=>'<option value="'+esc(e.name)+'" '+(defaults.includes(e.name)?'selected':'')+'>'+esc(e.name)+'</option>').join('');
 if(![...$('detectChannels').options].some(o=>o.selected))for(const o of $('detectChannels').options)o.selected=true;
 $('detectRelative').checked=objects.some(e=>e.name==='Hip');
 const options=project.labels.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.name)+'</option>').join('');$('detectPoseLabel').innerHTML=options;$('detectSegmentLabel').innerHTML=options;
 $('detectPoseLabel').value=project.labels.find(l=>/pose/i.test(l.name))?.id||activeLabel;$('detectSegmentLabel').value=activeLabel;
 preview=null;$('addSuggestions').disabled=true;$('detectResult').textContent='Exploratory suggestions only. Choose relevant hands/feet or other channels; preview and review every endpoint. No fixed pose count.';
 const c=$('signalPlot').getContext('2d');c.clearRect(0,0,680,125);$('assistDialog').showModal();
}
on('semiMode','click',openAssist);on('manualMode','click',()=>{$('manualMode').classList.add('active');$('semiMode').classList.remove('active');notice('Manual annotation: I sets start, O sets end, P marks a pose.');});
on('assistClose','click',()=>$('assistDialog').close());
$('assistForm').addEventListener('change',()=>{preview=null;$('addSuggestions').disabled=true;});
on('detectPreview','click',async()=>{
 const settings={names:[...$('detectChannels').selectedOptions].map(o=>o.value),threshold:$('detectThreshold').value,smoothMs:$('detectSmooth').value,stableMs:$('detectStable').value,separationMs:$('detectSeparation').value,relative:$('detectRelative').checked,preceding:$('detectPreceding').checked};
 if(!settings.names.length)throw Error('Select at least one detection channel.');
 $('detectResult').textContent='Computing candidate poses…';await new Promise(r=>setTimeout(r,20));preview=detectCandidates(data(),record(),settings);
 const count=preview.candidates.length;$('addSuggestions').disabled=!count;
 $('detectResult').textContent=count+' candidate poses · '+(count?count-1:0)+' possible connecting segments · threshold '+preview.settings.threshold.toFixed(4)+' m/s. Candidates use the slowest sample in each stable interval. Review in 3D; these are not confirmed movement endpoints.';
 const canvas=$('signalPlot'),c=canvas.getContext('2d'),speed=preview.speed,valid=speed.filter(v=>v!==null).sort((a,b)=>a-b),max=Math.max(preview.settings.threshold*2,valid[Math.floor(valid.length*.97)]||1,.001),w=680,h=125;
 c.clearRect(0,0,w,h);c.fillStyle='#f3f7f6';c.fillRect(0,0,w,h);c.strokeStyle='#3e9a8b';c.beginPath();let connected=false;
 for(let i=0;i<speed.length;i++){if(speed[i]===null){connected=false;continue;}const x=i/(speed.length-1)*(w-40)+25,y=h-20-clamp(speed[i]/max,0,1)*(h-40);if(connected)c.lineTo(x,y);else c.moveTo(x,y);connected=true;}c.stroke();
 const ty=h-20-preview.settings.threshold/max*(h-40);c.strokeStyle='#d9a54b';c.setLineDash([4,3]);c.beginPath();c.moveTo(25,ty);c.lineTo(w-15,ty);c.stroke();c.setLineDash([]);
 c.fillStyle='#bd8032';for(const v of preview.candidates){const x=v.index/(speed.length-1)*(w-40)+25;c.beginPath();c.arc(x,h-10,3,0,Math.PI*2);c.fill();}
 c.font='10px sans-serif';c.fillStyle='#617f85';c.fillText('Detection signal: m/s · gaps remain gaps',25,12);
});
on('assistForm','submit',e=>{
 e.preventDefault();needRecord();if(!preview?.candidates.length)throw Error('Preview candidates first.');
 const r=record(),pose=project.labels.find(l=>l.id===$('detectPoseLabel').value),segment=project.labels.find(l=>l.id===$('detectSegmentLabel').value),batch=uid(),list=[];
 for(const v of preview.candidates){
  const a=makeAnnotation(r,pose,'point',v.index);Object.assign(a,{origin:'detector',status:'suggested',detector:{...preview.settings,batch,stableStart:v.start,stableEnd:v.end,minimumSpeed:v.speed},notes:'Candidate stable interval: frames '+r.frames[v.start]+'–'+r.frames[v.end]+'. Verify movement completion.'});list.push(a);
 }
 if($('detectSegments').checked)for(let i=1;i<preview.candidates.length;i++){
  const a=makeAnnotation(r,segment,'segment',preview.candidates[i-1].index,preview.candidates[i].index);Object.assign(a,{origin:'detector',status:'suggested',detector:{...preview.settings,batch},notes:'Proposed interval between two candidate poses. Assign its sequence ID and technique manually.'});list.push(a);
 }
 edit(()=>{if($('replaceSuggestions').checked)project.annotations=project.annotations.filter(a=>a.recordingId!==active||a.status!=='suggested'||a.origin!=='detector');project.annotations.push(...list);});
 selected=list[0]?.id||null;$('assistDialog').close();if(selected)selectAnnotation(selected);notice('Added '+list.length+' editable suggestions. Adjust or delete them; mark reviewed only after checking. Pending suggestions are excluded from exports by default.');
});
on('help','click',async()=>{
 await ask('A workspace for your motion','<p><b>1 · Open a Motive CSV.</b> Check the import report and correct units/up axis under Recording & display. Bone positions show a skeleton; marker-only data shows points until you define connections.</p><p><b>2 · Navigate.</b> Drag the 3D view to orbit. Arrow keys step one actual CSV sample. Shift+arrows step N. Home/End jump to the ends.</p><p><b>3 · Annotate manually.</b> Select a label. Press I for start, O for end, or P for a terminal-pose point. Drag on a timeline track to draw a segment. Drag its edges to resize or middle to move.</p><p><b>4 · Or use Assisted.</b> Preview adjustable speed-based candidates. Suggestions are exploratory, can miss fast endpoints and can mistake pauses for poses. Edit, reject or mark each reviewed. No automatic technique naming or target count.</p><p><b>5 · Save and export.</b> Save project downloads editable JSON. Reopen it and reselect original CSVs. Export annotated CSV keeps original records and adds semicolon-separated labels. Export table includes richer metadata. Pending suggestions are excluded unless explicitly included.</p><p><b>Shortcuts:</b> Space play/pause · I/O start/end · P pose · Delete remove · Ctrl+Z undo · Ctrl+Shift+Z redo · [ / ] previous/next annotation · Escape cancel start.</p><p>Boundaries include both samples. Elapsed time is the difference between endpoint timestamps; a point has zero elapsed time. Raw data is never filtered or repaired. Synthetic demo data is not participant data.</p>','Got it');
});
document.addEventListener('keydown',run(e=>{
 if(document.querySelector('dialog[open]'))return;
 const typing=e.target.closest('input,textarea,select,[contenteditable=true]');
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveProject();return;}
 if(typing)return;
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'redo':'undo').click();return;}
 if(e.key==='?'){$('help').click();return;}if(!record()||!data())return;
 const shortcuts={' ':()=>startPlayback(),ArrowLeft:()=>{stop();seek(index-(e.shiftKey?stepN():1));},ArrowRight:()=>{stop();seek(index+(e.shiftKey?stepN():1));},Home:()=>{stop();seek(0);},End:()=>{stop();seek(record().frames.length-1);},i:()=>$('setStart').click(),o:()=>$('setEnd').click(),p:()=>$('markPose').click(),Delete:()=>$('deleteAnnotation').click(),'[':()=>navigateAnnotation(-1),']':()=>navigateAnnotation(1),Escape:()=>{pending=null;render();}};
 const fn=shortcuts[e.key]||shortcuts[e.key.toLowerCase()];if(fn){e.preventDefault();fn();}
}));
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
document.addEventListener('drop',run(async e=>{e.preventDefault();const files=[...e.dataTransfer.files];if(files.every(f=>f.name.toLowerCase().endsWith('.csv')))await loadFiles(files);else notice('Drop Motive CSV files here, or use Open project for a saved project.',true);}));
render();
