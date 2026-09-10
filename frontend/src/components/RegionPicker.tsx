import {useEffect,useRef,useState} from 'react';
export type Rectangle={x:number;y:number;width:number;height:number};
// eslint-disable-next-line react-refresh/only-export-components
export function rectangleBetween(a:{x:number;y:number},b:{x:number;y:number}):Rectangle {
  return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};
}
export function RegionPicker({image,onCancel,onSelect}:{image:string;onCancel:()=>void;onSelect:(value:string)=>void}) {
  const img=useRef<HTMLImageElement>(null);
  const start=useRef<{x:number;y:number}|null>(null);
  const [selection,setSelection]=useState<Rectangle|null>(null);
  const [error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
  function point(e:React.PointerEvent){
    const bounds=img.current!.getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(e.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(1,(e.clientY-bounds.top)/bounds.height))};
  }
  function confirm(){
    if(!selection || !img.current?.naturalWidth)return;
    try{
      const source=img.current;
      const x=Math.round(selection.x*source.naturalWidth),y=Math.round(selection.y*source.naturalHeight);
      const width=Math.min(source.naturalWidth-x,Math.round(selection.width*source.naturalWidth));
      const height=Math.min(source.naturalHeight-y,Math.round(selection.height*source.naturalHeight));
      if(width<8||height<8)throw Error('Выделите область немного больше — хотя бы 8 × 8 пикселей.');
      const canvas=document.createElement('canvas');
      const scale=Math.min(1,1920/width,1080/height);canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
      const context=canvas.getContext('2d');if(!context)throw Error('Не удалось подготовить изображение');
      context.drawImage(source,x,y,width,height,0,0,canvas.width,canvas.height);
      const value=canvas.toDataURL('image/jpeg',0.88);if(value.length>4000000)throw Error('Выберите меньшую область.');
      onSelect(value);
    }catch(e){setError(e instanceof Error?e.message:'Не удалось вырезать область');}
  }
  return <dialog ref={dialog} className="region-dialog" onCancel={e=>{e.preventDefault();onCancel();}} aria-labelledby="region-heading">
    <h2 id="region-heading">Что показать помощнику?</h2><p>Зажмите мышь и выделите нужную область. Пока ничего не отправлено.</p>
    <div className="region-image" onPointerDown={e=>{if(e.button!==0 || !img.current?.naturalWidth)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);start.current=point(e);setSelection(null);setError('');}} onPointerMove={e=>{if(start.current)setSelection(rectangleBetween(start.current,point(e)));}} onPointerUp={e=>{if(start.current){setSelection(rectangleBetween(start.current,point(e)));start.current=null;e.currentTarget.releasePointerCapture(e.pointerId);}}} onPointerCancel={()=>{start.current=null;}}>
      <img ref={img} src={image} alt="Снимок для выбора области" draggable={false}/>
      {selection && <div className="region-selection" style={{left:selection.x*100+'%',top:selection.y*100+'%',width:selection.width*100+'%',height:selection.height*100+'%'}}/>}
    </div>
    {error&&<p role="alert">{error}</p>}
    <div className="region-actions"><button className="secondary" onClick={onCancel}>Отмена</button><button className="secondary" onClick={()=>setSelection({x:0,y:0,width:1,height:1})}>Весь снимок</button><button disabled={!selection||selection.width<=0||selection.height<=0} onClick={confirm}>Прикрепить область</button></div>
  </dialog>;
}
