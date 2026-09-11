function screenSourceForDisplay(sources, display) {
  if (!Array.isArray(sources) || !sources.length) return null;
  const displayId = String(display?.id ?? "");
  return (
    sources.find((source) => String(source.display_id ?? "") === displayId) ||
    sources[0]
  );
}

module.exports = { screenSourceForDisplay };
