export {};
declare global {
  interface Window {
    jobghostDesktop?: {
      openChat?:()=>Promise<void>;
      openExtensionFolder?:()=>Promise<string>;
      setOverlay?:(options:{opacity?:number;passthrough?:boolean;protection?:boolean})=>Promise<{opacity:number;passthrough:boolean;protection:boolean;protected:boolean}>;
      hide?:()=>Promise<void>;
      quit?:()=>Promise<void>;
      setCapture?:(active:boolean)=>Promise<void>;
      captureRegion?:()=>Promise<string|null>;
      getState:()=>Promise<{compact:boolean;alwaysOnTop:boolean;failedShortcuts:string[];pointerShortcut?:string|null;askShortcut?:string|null;overlay?:{opacity:number;passthrough:boolean;protection:boolean;protected:boolean};serviceBrowser?:{hidden:number}}>;
      setCompact:(value:boolean)=>Promise<{compact:boolean;alwaysOnTop:boolean;failedShortcuts:string[]}>;
      setCompactHeight?:(value:number)=>Promise<{compact:boolean;alwaysOnTop:boolean;failedShortcuts:string[]}>;
      setCompactSize?:(width:number,height:number)=>Promise<{compact:boolean;alwaysOnTop:boolean;failedShortcuts:string[]}>;
      onAction:(callback:(action:'ask'|'snapshot'|'stop')=>void)=>()=>void;
    };
  }
}
