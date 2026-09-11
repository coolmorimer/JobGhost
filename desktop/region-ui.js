const image=document.getElementById('image');
const box=document.getElementById('selection');
let start=null;
window.regionCapture.image().then(value=>{image.src=value;});
const rectangle=event=>({x:Math.min(start.x,event.clientX),y:Math.min(start.y,event.clientY),width:Math.abs(start.x-event.clientX),height:Math.abs(start.y-event.clientY)});
document.addEventListener('keydown',event=>{if(event.key==='Escape')void window.regionCapture.select(null);});
document.addEventListener('pointerdown',event=>{if(event.button===0)start={x:event.clientX,y:event.clientY};});
document.addEventListener('pointermove',event=>{if(!start)return;const r=rectangle(event);Object.assign(box.style,{display:'block',left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});});
document.addEventListener('pointerup',event=>{if(!start)return;const r=rectangle(event);start=null;if(r.width<8||r.height<8)return;void window.regionCapture.select({x:r.x/innerWidth,y:r.y/innerHeight,width:r.width/innerWidth,height:r.height/innerHeight});});
