const assert = require("node:assert/strict");
const test = require("node:test");
const { screenSourceForDisplay } = require("./capture-source.cjs");

test("manual screenshot selects the current display without a chooser", () => {
  const sources = [
    { id: "screen:1", display_id: "101" },
    { id: "screen:2", display_id: "202" },
  ];
  assert.equal(screenSourceForDisplay(sources, { id: 202 }), sources[1]);
});

test("manual screenshot has a deterministic fallback", () => {
  const source = { id: "screen:1", display_id: "" };
  assert.equal(screenSourceForDisplay([source], { id: 999 }), source);
  assert.equal(screenSourceForDisplay([], { id: 999 }), null);
});
