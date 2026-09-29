import assert from "node:assert/strict";
import test from "node:test";
import { mergeStablePositions, parseSavedPositions } from "../src/presentation.js";

test("stable positions survive reload while removed IDs disappear and new IDs use layout", () => {
  assert.deepEqual(
    mergeStablePositions(
      ["survives", "saved", "new"],
      { survives: { x: 1, y: 2 }, removed: { x: 9, y: 9 } },
      { saved: { x: 3, y: 4 } },
      { survives: { x: 10, y: 10 }, saved: { x: 20, y: 20 }, new: { x: 5, y: 6 } },
    ),
    {
      survives: { x: 1, y: 2 },
      saved: { x: 3, y: 4 },
      new: { x: 5, y: 6 },
    },
  );
});
test("saved positions are restored only when they are well formed", () => {
  const saved = JSON.stringify({ start: { x: 1, y: 2 }, removed: { x: 3, y: 4 } });
  assert.deepEqual(
    mergeStablePositions(["start", "new"], {}, parseSavedPositions(saved), {
      start: { x: 50, y: 50 },
      new: { x: 8, y: 9 },
    }),
    { start: { x: 1, y: 2 }, new: { x: 8, y: 9 } },
  );
  assert.deepEqual(parseSavedPositions(null), {});
  assert.deepEqual(parseSavedPositions("not json"), {});
  assert.deepEqual(parseSavedPositions(JSON.stringify({ start: { x: "1", y: 2 } })), {});
});
