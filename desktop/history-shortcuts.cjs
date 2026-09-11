function historyShortcuts(shortcuts, send) {
  const keys = [['Control+Left', 'previous-answer'], ['Control+Right', 'next-answer']];
  const registered = new Set();
  return enabled => {
    for (const [key, action] of keys) {
      if (enabled && !registered.has(key)) {
        if (shortcuts.register(key, () => send(action))) registered.add(key);
      } else if (!enabled && registered.has(key)) {
        shortcuts.unregister(key);
        registered.delete(key);
      }
    }
  };
}
module.exports = {historyShortcuts};
