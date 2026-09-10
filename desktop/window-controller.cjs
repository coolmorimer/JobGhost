function createWindowController(window, screen, topmost=null) {
  let compact = false;
  let saved = null;
  const compactWidth = 860;
  const compactMinHeight = 180;
  const compactMaxHeight = 700;
  return {
    state: () => ({compact, alwaysOnTop:topmost?topmost.get():window.isAlwaysOnTop()}),
    setCompact(value) {
      if (typeof value !== 'boolean') throw new TypeError('compact must be boolean');
      if (value === compact) return this.state();
      if (value) {
        saved = {bounds:window.getBounds(), maximized:window.isMaximized(), top:window.isAlwaysOnTop()};
        if (saved.maximized) window.unmaximize();
        const area=screen.getDisplayMatching(saved.bounds).workArea;
        const width=Math.min(compactWidth,area.width), height=Math.min(compactMaxHeight,area.height);
        window.setMinimumSize(340,compactMinHeight);
        window.setBounds({x:area.x+area.width-width,y:area.y,width,height});
        window.setSkipTaskbar(true);
        // The explicit Windows-compatible level avoids transparent overlays being
        // placed back into the normal z-order by the compositor.
        window.setAlwaysOnTop(true,'screen-saver');
        if(topmost&&!topmost.get())topmost.set(true);
      } else if (saved) {
        window.setMinimumSize(650,500);
        window.setBounds(saved.bounds);
        window.setSkipTaskbar(false);
        window.setAlwaysOnTop(saved.top);
        if(topmost&&topmost.get()!==saved.top)topmost.set(saved.top);
        if (saved.maximized) window.maximize();
      }
      compact=value;
      return this.state();
    },
    setCompactHeight(value) {
      if (!Number.isFinite(value)) throw new TypeError('compact height must be finite');
      if (!compact) return this.state();
      const current=window.getBounds();
      const area=screen.getDisplayMatching(current).workArea;
      const height=Math.max(compactMinHeight,Math.min(Math.round(value),compactMaxHeight,area.height));
      const y=Math.max(area.y,Math.min(current.y,area.y+area.height-height));
      window.setBounds({...current,y,height});
      return this.state();
    },
  };
}
function trustedSender(event, window, origin) {
  try {
    return event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && new URL(event.senderFrame.url).origin === origin;
  } catch {return false;}
}
module.exports={createWindowController,trustedSender};
