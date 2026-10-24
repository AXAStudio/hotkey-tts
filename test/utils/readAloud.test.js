const test = require("node:test");
const assert = require("node:assert/strict");

let readAloud;

test.before(async () => {
  readAloud = await import("../../src/utils/readAloud.ts");
});

test("wrapped selections are spoken as one run of text", () => {
  assert.equal(
    readAloud.prepareReadAloudText("  The quick brown\r\nfox jumps\n\n over\tthe dog. "),
    "The quick brown fox jumps over the dog."
  );
});

test("a selection with nothing to speak reads as null", () => {
  assert.equal(readAloud.prepareReadAloudText(" \n\t "), null);
  assert.equal(readAloud.prepareReadAloudText(""), null);
  assert.equal(readAloud.prepareReadAloudText(null), null);
  assert.equal(readAloud.prepareReadAloudText(undefined), null);
});

test("the saved voice is found by its voiceURI", () => {
  const voices = [
    { voiceURI: "Microsoft David - English (United States)", lang: "en-US" },
    { voiceURI: "Microsoft Zira - English (United States)", lang: "en-US" },
  ];
  assert.equal(
    readAloud.resolveReadAloudVoice(voices, "Microsoft Zira - English (United States)"),
    voices[1]
  );
});

test("an unset or uninstalled voice falls back to the system default", () => {
  const voices = [{ voiceURI: "Microsoft David - English (United States)", lang: "en-US" }];
  assert.equal(readAloud.resolveReadAloudVoice(voices, ""), null);
  assert.equal(readAloud.resolveReadAloudVoice(voices, "Removed Voice"), null);
  assert.equal(readAloud.resolveReadAloudVoice([], "Microsoft David"), null);
});
