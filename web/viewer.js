
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {EDGES} from './core.js';
export class MotionViewer{
 constructor(container,onPick){
  this.container=container;this.data=null;this.record=null;this.index=0;this.meshes=[];this.lines=[];this.names=false;
  this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#0e171e');
  this.camera=new THREE.PerspectiveCamera(38,1,.001,10000);this.camera.position.set(2.5,1.7,3.3);
  this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));container.append(this.renderer.domElement);
  this.overlay=document.createElement('canvas');this.overlay.className='names-overlay';container.append(this.overlay);this.ctx=this.overlay.getContext('2d');
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,.9,0);this.controls.enableDamping=false;
  this.scene.add(new THREE.HemisphereLight(0xe2f3ff,0x334050,2.5));
  this.grid=new THREE.GridHelper(10,40,0x35505a,0x1c303a);this.scene.add(this.grid);
  const axes=new THREE.AxesHelper(.4);axes.position.set(-1.1,.002,0);this.scene.add(axes);
  this.skeleton=new THREE.Group();this.scene.add(this.skeleton);
  this.jointGeometry=new THREE.SphereGeometry(.017,12,8);this.boneGeometry=new THREE.CylinderGeometry(.009,.009,1,8);
  this.materials={left:new THREE.MeshStandardMaterial({color:0x61c6bd,roughness:.45}),right:new THREE.MeshStandardMaterial({color:0xe8b279,roughness:.45}),body:new THREE.MeshStandardMaterial({color:0xd3dfe8,roughness:.45})};
  this.controls.addEventListener('change',()=>this.render());
  new ResizeObserver(()=>this.resize()).observe(container);
  this.renderer.domElement.addEventListener('dblclick',event=>{
   if(!this.objects?.length)return;const r=this.renderer.domElement.getBoundingClientRect(),mouse=new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);
   const ray=new THREE.Raycaster();ray.setFromCamera(mouse,this.camera);const hit=ray.intersectObjects(this.meshes.filter(m=>m.visible))[0];if(hit)onPick(hit.object.userData.name);
  });this.resize();
 }
 resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);this.overlay.width=w*devicePixelRatio;this.overlay.height=h*devicePixelRatio;this.overlay.style.width=w+'px';this.overlay.style.height=h+'px';this.render();}
 set(data,record){
  this.data=data;this.record=record;this.skeleton.clear();this.meshes=[];this.lines=[];
  if(!data){this.objects=[];this.render();return;}
  const key=record.display||this.choices(data)[0]?.key;
  this.objects=data.entities.filter(o=>o.type+'|'+o.group===key);this.lookup=new Map(this.objects.map((o,i)=>[o.name,i]));
  for(const o of this.objects){
   const m=new THREE.Mesh(this.jointGeometry,this.materials[o.name.startsWith('L')?'left':o.name.startsWith('R')?'right':'body']);m.userData.name=o.full;this.skeleton.add(m);this.meshes.push(m);
  }
  const boneMode=this.objects[0]?.type==='Bone';
  const edges=record.connections?.length?record.connections:(boneMode?EDGES:[]);
  for(const [a,b] of edges){
   if(!this.lookup.has(a)||!this.lookup.has(b))continue;
   const m=new THREE.Mesh(this.boneGeometry,this.materials[a.startsWith('L')?'left':a.startsWith('R')?'right':'body']);this.skeleton.add(m);this.lines.push({mesh:m,a:this.lookup.get(a),b:this.lookup.get(b)});
  }
  this.frame(0);this.fit();
 }
 choices(data=this.data){return data?[...new Set(data.entities.map(o=>o.type+'|'+o.group))].sort((a,b)=>(a.startsWith('Bone')?0:1)-(b.startsWith('Bone')?0:1)).map(key=>({key,name:key.replace('|',' · ')})):[];}
 vector(o,index){
  const p=o.positions,j=index*3;let [x,y,z]=[p[j],p[j+1],p[j+2]];if(![x,y,z].every(Number.isFinite))return null;
  const unit=this.record.unit||this.data.units;const scale=/millimeter|^mm$/i.test(unit)?.001:/centimeter|^cm$/i.test(unit)?.01:1;
  [x,y,z]=[x*scale,y*scale,z*scale];const axis=this.record.up||'Y';
  return axis==='Z'?new THREE.Vector3(x,z,-y):axis==='X'?new THREE.Vector3(-y,x,z):new THREE.Vector3(x,y,z);
 }
 frame(index){
  this.index=index;if(!this.data){this.render();return;}
  this.points=this.objects.map(o=>this.vector(o,index));let visible=0;
  this.meshes.forEach((m,i)=>{m.visible=!!this.points[i];if(m.visible){m.position.copy(this.points[i]);visible++;}});
  const up=new THREE.Vector3(0,1,0);
  for(const l of this.lines){const a=this.points[l.a],b=this.points[l.b];l.mesh.visible=!!a&&!!b;if(a&&b){const d=new THREE.Vector3().subVectors(b,a);l.mesh.position.copy(a).add(b).multiplyScalar(.5);l.mesh.scale.set(1,d.length(),1);l.mesh.quaternion.setFromUnitVectors(up,d.normalize());}}
  this.visible=visible;this.render();
 }
 fit(){
  if(!this.data||!this.objects?.length)return;
  const box=new THREE.Box3();
  for(let i=0;i<this.data.frames.length;i+=Math.max(1,Math.floor(this.data.frames.length/100)))for(const o of this.objects){const v=this.vector(o,i);if(v)box.expandByPoint(v);}
  if(box.isEmpty())return;const centre=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),span=Math.max(size.x,size.y,size.z,.5);
  this.centre=centre;this.distance=span*2.1;this.controls.target.copy(centre);this.preset('perspective');this.grid.position.y=box.min.y-.02;
 }
 preset(which){
  const c=this.centre||new THREE.Vector3(0,.9,0),d=this.distance||3.5;
  const offset=which==='front'?[0,0,d]:which==='side'?[d,0,0]:which==='top'?[0,d,.0001]:[d*.7,d*.35,d*.9];
  this.camera.position.copy(c).add(new THREE.Vector3(...offset));this.camera.up.set(0,1,0);if(which==='top')this.camera.up.set(0,0,-1);
  this.controls.target.copy(c);this.controls.update();this.render();
 }
 render(){
  if(!this.renderer)return;this.renderer.render(this.scene,this.camera);
  const c=this.ctx,w=this.overlay.width/devicePixelRatio,h=this.overlay.height/devicePixelRatio;c.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);c.clearRect(0,0,w,h);
  if(this.names&&this.points){c.font='11px sans-serif';c.fillStyle='#e1edf4';this.points.forEach((v,i)=>{if(!v)return;const p=v.clone().project(this.camera);if(p.z<1)c.fillText(this.objects[i].name,(p.x+1)*w/2+7,(-p.y+1)*h/2);});}
  if(this.data&&this.visible===0){c.font='15px sans-serif';c.fillStyle='#f1bf73';c.fillText('No valid positions at this sample',25,h/2);}
 }
}
