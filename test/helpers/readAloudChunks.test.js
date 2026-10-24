const test = require("node:test");
const assert = require("node:assert/strict");

let chunks;

test.before(async () => {
  chunks = await import("../../src/helpers/readAloudChunks.js");
});

const TEXT =
  "Hello there. This is a fairly long sentence, with a clause; and another one that keeps " +
  "going and going without any punctuation at all for a while. Short! And “quoted.” End";

test("chunks respect the limit and lose no text", () => {
  for (const maxChars of [40, 100, 400]) {
    const result = chunks.splitReadAloudText(TEXT, maxChars);
    assert.ok(
      result.every((chunk) => chunk.length <= maxChars),
      `max ${maxChars}`
    );
    assert.equal(result.join(" "), TEXT);
  }
});

test("whole sentences are packed together before a sentence is split", () => {
  assert.deepEqual(chunks.splitReadAloudText("One. Two. Three.", 10), ["One. Two.", "Three."]);
});

test("a long sentence breaks after clause punctuation, then at spaces", () => {
  assert.deepEqual(chunks.splitReadAloudText("alpha beta, gamma delta epsilon", 14), [
    "alpha beta,",
    "gamma delta",
    "epsilon",
  ]);
});

test("a word longer than the limit is cut", () => {
  assert.deepEqual(chunks.splitReadAloudText("Supercalifragilistic", 10), [
    "Supercalif",
    "ragilistic",
  ]);
});

test("blank text has no chunks", () => {
  assert.deepEqual(chunks.splitReadAloudText(" \n\t ", 10), []);
  assert.deepEqual(chunks.splitReadAloudText(null, 10), []);
});
