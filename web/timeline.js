
import {clamp} from './core.js';
export class Timeline{
 constructor(canvas,callbacks){
  this.canvas=canvas;this.ctx=canvas.getContext('2d');this.callbacks=callbacks;this.zoom=1;this.offset=0;this.drag=null;this.state={};this.rects=[];this.left=125;
  new ResizeObserver(()=>this.draw()).observe(canvas.parentElement);
  canvas.addEventListener('pointerdown',e=>this.down(e));canvas.addEventListener('pointermove',e=>this.move(e));canvas.addEventListener('pointerup',e=>this.up(e));canvas.addEventListener('pointercancel',()=>{this.drag=null;this.draw();});
  canvas.addEventListener('wheel',e=>{if(!this.state.record)return;e.preventDefault();if(e.ctrlKey)this.changeZoom(e.deltaY<0?1.4:1/1.4);else{this.offset=clamp(this.offset+e.deltaY*this.span/500,0,Math.max(0,this.n-this.span));this.draw();}},{passive:false});
 }
 update(state){this.state=state;this.draw();}
 get n(){return this.state.record?.frames.length||1;}
 get span(){return Math.max(1,(this.n-1)/this.zoom);}
 x(i){return this.left+(i-this.offset)/this.span*(this.width-this.left-12);}
 frame(x){return Math.round(clamp(this.offset+(x-this.left)/(this.width-this.left-12)*this.span,0,this.n-1));}
 changeZoom(factor){const centre=this.state.index||0;this.zoom=clamp(this.zoom*factor,1,Math.max(1,this.n/15));this.offset=clamp(centre-this.span/2,0,Math.max(0,this.n-1-this.span));this.draw();}
 fit(){this.zoom=1;this.offset=0;this.draw();}
 pan(fraction){this.offset=clamp(fraction,0,1)*Math.max(0,this.n-1-this.span);this.draw();}
 draw(){
  const {project:p,record:r,index=0,selection}=this.state;if(!p)return;
  const c=this.ctx,dpr=devicePixelRatio||1,w=this.canvas.parentElement.clientWidth;this.width=w;
  const annotations=p.annotations.filter(a=>a.recordingId===r?.id).map(a=>this.drag?.id===a.id?{...a,start:this.drag.start,end:this.drag.end}:a);
  this.rows=[];this.rects=[];let y=28;
  for(const label of p.labels){
   const list=annotations.filter(a=>a.labelId===label.id).sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id)),ends=[];
   const assigned=list.map(a=>{let lane=ends.findIndex(n=>n<a.start-1);if(lane<0)lane=ends.length;ends[lane]=a.end;return {a,lane};});
   const height=Math.max(1,ends.length)*27+10;this.rows.push({label,y,height});
   for(const {a,lane} of assigned){const x=this.x(a.start),end=this.x(a.end);this.rects.push({a,label,x:a.kind==='point'?x-6:x,y:y+lane*27+5,w:a.kind==='point'?12:Math.max(8,end-x),h:21});}
   y+=height;
  }
  const h=Math.max(110,y+12);if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=w*dpr;this.canvas.height=h*dpr;this.canvas.style.height=h+'px';}
  c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.fillStyle='#fff';c.fillRect(0,0,w,h);
  c.fillStyle='#f6f9f8';c.fillRect(0,0,w,27);c.font='10px Segoe UI';c.textBaseline='middle';
  for(let k=0;k<7;k++){const i=Math.round(clamp(this.offset+k*this.span/6,0,this.n-1)),x=this.x(i);c.strokeStyle='#edf2f2';c.beginPath();c.moveTo(x,27);c.lineTo(x,h);c.stroke();c.fillStyle='#899da4';c.fillText(r?r.times[i].toFixed(2)+' s':'',x-12,13);}
  c.fillStyle='#f9fbfa';c.fillRect(0,27,this.left-1,h);
  for(const row of this.rows){c.fillStyle='#71868e';c.font='10px Segoe UI';c.fillText(row.label.name.length>18?row.label.name.slice(0,16)+'…':row.label.name,12,row.y+16);c.strokeStyle='#eef2f2';c.beginPath();c.moveTo(0,row.y+row.height);c.lineTo(w,row.y+row.height);c.stroke();}
  c.save();c.beginPath();c.rect(this.left,27,w-this.left,h-27);c.clip();
  for(const q of this.rects){
   const {a,label,x,y,w:rw,h:rh}=q;c.globalAlpha=a.status==='suggested'?.45:.88;c.fillStyle=label.color;
   c.beginPath();if(a.kind==='point'){c.moveTo(x+6,y);c.lineTo(x+12,y+rh/2);c.lineTo(x+6,y+rh);c.lineTo(x,y+rh/2);c.closePath();}else c.roundRect(x,y,rw,rh,4);c.fill();c.globalAlpha=1;
   if(a.status==='suggested'||a.id===selection){c.strokeStyle=a.id===selection?'#244e51':label.color;c.lineWidth=a.id===selection?2:1;c.setLineDash(a.status==='suggested'?[3,2]:[]);c.stroke();c.setLineDash([]);}
   if(a.kind==='segment'&&a.id===selection){c.fillStyle='#fff';c.fillRect(x+3,y+5,2,rh-10);c.fillRect(x+rw-5,y+5,2,rh-10);}
   if(rw>55){c.fillStyle='#123d3c';c.font='9px Segoe UI';c.fillText(a.sequence||label.name,x+8,y+rh/2,rw-14);}
  }
  if(this.drag?.mode==='create'){c.globalAlpha=.4;c.fillStyle=this.drag.color;c.fillRect(this.x(this.drag.start),this.drag.y,Math.max(5,this.x(this.drag.end)-this.x(this.drag.start)),21);c.globalAlpha=1;}
  const px=this.x(index);c.strokeStyle='#cf8f38';c.lineWidth=1.5;c.beginPath();c.moveTo(px,0);c.lineTo(px,h);c.stroke();c.fillStyle='#cf8f38';c.beginPath();c.moveTo(px-4,23);c.lineTo(px+4,23);c.lineTo(px,28);c.fill();c.restore();
  this.callbacks.panChanged?.(this.offset/Math.max(1,this.n-1-this.span));
 }
 position(e){const r=this.canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
 hit(pos){return [...this.rects].reverse().find(q=>pos.x>=Math.max(this.left,q.x-3)&&pos.x<=q.x+q.w+3&&pos.y>=q.y&&pos.y<=q.y+q.h);}
 down(e){
  if(!this.state.record||e.button!==0)return;const pos=this.position(e);this.canvas.focus();this.canvas.setPointerCapture(e.pointerId);
  if(pos.x<this.left)return;
  const hit=this.hit(pos),f=this.frame(pos.x);
  if(hit){
   this.callbacks.select(hit.a.id);const mode=hit.a.kind==='point'?'move':Math.abs(pos.x-hit.x)<8?'left':Math.abs(pos.x-(hit.x+hit.w))<8?'right':hit.a.start===hit.a.end?'expand':'move';
   this.drag={mode,id:hit.a.id,start:hit.a.start,end:hit.a.end,s0:hit.a.start,e0:hit.a.end,anchor:f,changed:false,point:hit.a.kind==='point'};
  }else if(pos.y<27){this.callbacks.seek(f);}
  else{const row=this.rows.find(r=>pos.y>=r.y&&pos.y<r.y+r.height);if(row)this.drag={mode:'create',labelId:row.label.id,color:row.label.color,start:f,end:f,anchor:f,y:row.y+5,changed:false};}
  this.draw();
 }
 move(e){
  const pos=this.position(e),d=this.drag;
  if(!d){const h=this.hit(pos);this.canvas.style.cursor=h?(h.a.kind==='point'?'grab':Math.abs(pos.x-h.x)<8||Math.abs(pos.x-h.x-h.w)<8?'ew-resize':'grab'):'crosshair';return;}
  const f=this.frame(pos.x);d.changed=true;
  if(d.mode==='create'||d.mode==='expand'){d.start=Math.min(d.anchor,f);d.end=Math.max(d.anchor,f);}
  else if(d.mode==='left')d.start=Math.min(f,d.end);
  else if(d.mode==='right')d.end=Math.max(f,d.start);
  else{const length=d.e0-d.s0;d.start=clamp(d.s0+f-d.anchor,0,this.n-1-length);d.end=d.start+length;}
  this.callbacks.seek(f);this.draw();
 }
 up(){
  const d=this.drag;this.drag=null;
  if(d){if(d.mode==='create')this.callbacks.create(d.labelId,d.start,d.end);else if(d.changed)this.callbacks.edit(d.id,d.start,d.end);this.draw();}
 }
}
