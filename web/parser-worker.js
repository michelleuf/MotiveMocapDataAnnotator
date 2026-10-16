
import {parseMotive} from './core.js';
self.onmessage=event=>{
 try{const data=parseMotive(event.data.text,event.data.name);self.postMessage({data},data.entities.map(e=>e.positions.buffer));}
 catch(error){self.postMessage({error:error.message});}
};
