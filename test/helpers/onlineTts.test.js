const test = require("node:test");
const assert = require("node:assert/strict");
const onlineTts = require("../../src/helpers/onlineTts");

test("Edge speed is sent as a signed percentage", () => {
  assert.equal(onlineTts.edgeRate(1), "+0%");
  assert.equal(onlineTts.edgeRate(1.25), "+25%");
  assert.equal(onlineTts.edgeRate(0.75), "-25%");
  assert.equal(onlineTts.edgeRate(2), "+100%");
});

test("Edge SSML escapes markup and strips control characters", () => {
  const ssml = onlineTts.buildEdgeSsml("a < b & c > d\u000bnext", "en-US-ChristopherNeural", 1.5);
  assert.match(ssml, /<voice name='en-US-ChristopherNeural'>/);
  assert.match(ssml, /rate='\+50%'/);
  assert.match(ssml, />a &lt; b &amp; c &gt; d next<\/prosody>/);
});

test("Edge timestamps use JavaScript's UTC Date string", () => {
  assert.equal(
    onlineTts.edgeTimestamp(new Date(Date.UTC(2026, 9, 24, 9, 5, 7))),
    "Sat Oct 24 2026 09:05:07 GMT+0000 (Coordinated Universal Time)"
  );
});

test("Edge binary frames split into headers and audio", () => {
  const head = Buffer.from("X-RequestId:abc\r\nContent-Type:audio/mpeg\r\nPath:audio");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(head.length);
  const frame = onlineTts.parseEdgeBinaryFrame(
    Buffer.concat([length, head, Buffer.from([0xff, 0xf3])])
  );
  assert.equal(frame.headers.Path, "audio");
  assert.equal(frame.headers["Content-Type"], "audio/mpeg");
  assert.deepEqual([...frame.audio], [0xff, 0xf3]);
  assert.throws(() => onlineTts.parseEdgeBinaryFrame(Buffer.from([0x00, 0x40, 0x41])));
});

test("Edge text frames report their path", () => {
  assert.equal(
    onlineTts.parseEdgeTextPath("X-RequestId:abc\r\nPath:turn.end\r\n\r\n{}"),
    "turn.end"
  );
  assert.equal(onlineTts.parseEdgeTextPath("X-RequestId:abc\r\n\r\n{}"), null);
});

test("an invalid Edge voice never reaches the SSML", async () => {
  await assert.rejects(
    onlineTts.synthesizeReadAloud({ engine: "edge", text: "hi", voice: "x' onload='" }),
    /Invalid Edge voice/
  );
});

test("requests are validated before anything is sent", async () => {
  await assert.rejects(onlineTts.synthesizeReadAloud({ engine: "edge", text: "  " }), /Nothing/);
  await assert.rejects(
    onlineTts.synthesizeReadAloud({ engine: "edge", text: "a".repeat(2001) }),
    /too long/
  );
  await assert.rejects(onlineTts.synthesizeReadAloud({ engine: "other", text: "hi" }), /Unknown/);
});

test("Google request bodies match gTTS", () => {
  // gTTS 2.5.4: gTTS("Hi é", lang="en")._package_rpc("Hi é") (quote vs encodeURIComponent
  // differ only in "/", which the body never contains here).
  const body = onlineTts.buildGoogleRequestBody("Hi é", "en");
  assert.equal(
    decodeURIComponent(body.slice("f.req=".length, -1)),
    '[[["jQ1olc","[\\"Hi \\\\u00e9\\",\\"en\\",null,\\"null\\"]",null,"generic"]]]'
  );
  assert.ok(body.endsWith("&"));
});

test("Google audio is decoded from the batchexecute response", () => {
  const audio = Buffer.from([0xff, 0xf3, 0x84, 0xc4]);
  const response = `)]}'\n\n123\n[["wrb.fr","jQ1olc","[\\"${audio.toString("base64")}\\"]",null,null,null,"generic"]]\n`;
  assert.deepEqual([...onlineTts.parseGoogleAudio(response)], [...audio]);
  assert.throws(() => onlineTts.parseGoogleAudio("[]"), /no audio/);
});

test("Google speaks long text in 100-character requests and joins the audio", async () => {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    requests.push(decodeURIComponent(init.body));
    const audio = Buffer.from([requests.length]).toString("base64");
    return { ok: true, text: async () => `["jQ1olc","[\\"${audio}\\"]"]` };
  };
  const text = "One sentence that is fairly long and keeps going for a while. ".repeat(4).trim();
  const audio = await onlineTts.synthesizeGoogle(text, { fetchImpl });
  assert.ok(requests.length >= 3);
  assert.deepEqual(
    [...audio],
    requests.map((_, index) => index + 1)
  );
  for (const request of requests) {
    const spoken = JSON.parse(JSON.parse(request.slice("f.req=".length, -1))[0][0][1])[0];
    assert.ok(spoken.length <= 100, spoken);
  }
});
