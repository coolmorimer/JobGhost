const {BrowserWindow, desktopCapturer, screen, ipcMain}=require('electron');
const path=require('node:path');
const {screenSourceForDisplay}=require('./capture-source.cjs');
let busy=false;

function cropBounds(value,width,height){
  if(!value || !['x','y','width','height'].every(key=>Number.isFinite(value[key])))throw Error('Некорректная область');
  const x=Math.max(0,Math.min(width-1,Math.round(value.x*width)));
  const y=Math.max(0,Math.min(height-1,Math.round(value.y*height)));
  const w=Math.min(width-x,Math.round(value.width*width));
  const h=Math.min(height-y,Math.round(value.height*height));
  if(w<8 || h<8)throw Error('Выделите область хотя бы 8 × 8 пикселей');
  return {x,y,width:w,height:h};
}

async function captureRegion(owner){
  if(busy)return null;
  busy=true;
  const visible=owner.isVisible();
  let picker;
  try{
    const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    owner.hide();
    await new Promise(resolve=>setTimeout(resolve,150));
    const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}});
    const source=screenSourceForDisplay(sources,display);
    if(!source || source.thumbnail.isEmpty())throw Error('Не удалось получить снимок экрана');
    const picture=source.thumbnail;
    picker=new BrowserWindow({...display.bounds,show:false,frame:false,resizable:false,skipTaskbar:true,alwaysOnTop:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'region-preload.cjs')}});
    picker.setContentProtection(true);
    picker.setAlwaysOnTop(true,'screen-saver');
    const trusted=event=>event.sender===picker.webContents && event.senderFrame===picker.webContents.mainFrame;
    const selection=new Promise(resolve=>{
      ipcMain.handle('jobghost:region-image',event=>{if(!trusted(event))throw Error('Недопустимый источник');return picture.toDataURL();});
      ipcMain.handle('jobghost:region-select',(event,value)=>{if(!trusted(event))throw Error('Недопустимый источник');resolve(value);});
      picker.once('closed',()=>resolve(null));
    });
    await picker.loadFile(path.join(__dirname,'region.html'));
    picker.show();picker.focus();
    const selected=await selection;
    if(!selected)return null;
    const size=picture.getSize();
    let cropped=picture.crop(cropBounds(selected,size.width,size.height));
    const dimensions=cropped.getSize();
    const scale=Math.min(1,1920/dimensions.width,1080/dimensions.height);
    if(scale<1)cropped=cropped.resize({width:Math.round(dimensions.width*scale),height:Math.round(dimensions.height*scale)});
    return 'data:image/jpeg;base64,'+cropped.toJPEG(88).toString('base64');
  }finally{
    ipcMain.removeHandler('jobghost:region-image');
    ipcMain.removeHandler('jobghost:region-select');
    if(picker&&!picker.isDestroyed())picker.destroy();
    if(visible&&!owner.isDestroyed())owner.show();
    busy=false;
  }
}
module.exports={captureRegion,cropBounds};
