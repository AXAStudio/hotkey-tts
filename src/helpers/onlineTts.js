// Online voices for read aloud, ported from the Python libraries the original
// TTS highlighter used: Microsoft Edge's neural voices (edge-tts 7.3.1,
// communicate.py) and Google Translate's voice (gTTS 2.5.4, tts.py). Both are
// unofficial endpoints: a change on Microsoft's or Google's side can break them,
// and read aloud then falls back to the system voices.
const crypto = require("crypto");
const WebSocket = require("ws");
const { generateSecMsGec, TRUSTED_CLIENT_TOKEN } = require("./edgeTtsToken");
const { splitReadAloudText } = require("./readAloudChunks");

const EDGE_BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const EDGE_WSS_URL = `wss://${EDGE_BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const EDGE_VOICE_LIST_URL = `https://${EDGE_BASE_URL}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const EDGE_BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" +
    ` (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36` +
    ` Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
};
const EDGE_WSS_HEADERS = {
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  ...EDGE_BASE_HEADERS,
};
const EDGE_VOICE_HEADERS = {
  Authority: "speech.platform.bing.com",
  "Sec-CH-UA": `" Not;A Brand";v="99", "Microsoft Edge";v="${CHROMIUM_MAJOR_VERSION}", "Chromium";v="${CHROMIUM_MAJOR_VERSION}"`,
  "Sec-CH-UA-Mobile": "?0",
  Accept: "*/*",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  ...EDGE_BASE_HEADERS,
};
const EDGE_TIMEOUT_MS = 20000;
// Edge voice short names, e.g. en-US-ChristopherNeural. Checked before the
// name goes into an SSML attribute.
const EDGE_VOICE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]+){2,3}$/;
const DEFAULT_EDGE_VOICE = "en-US-ChristopherNeural";

const GOOGLE_TTS_URL = "https://translate.google.com/_/TranslateWebserverUi/data/batchexecute";
const GOOGLE_TTS_MAX_CHARS = 100;
const GOOGLE_TTS_HEADERS = {
  Referer: "http://translate.google.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/47.0.2526.106 Safari/537.36",
  "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
};
const GOOGLE_TTS_RPC = "jQ1olc";
const GOOGLE_TIMEOUT_MS = 15000;

// One request's worth of text; the renderer sends chunks well under this.
const MAX_REQUEST_CHARS = 2000;

// Seconds the local clock is behind Microsoft's, learned from a 403's Date
// header: the token is bound to a 5-minute window of server time.
let edgeClockSkewSeconds = 0;
let edgeVoicesCache = null;

const edgeNowSeconds = () => Date.now() / 1000 + edgeClockSkewSeconds;

function edgeRate(rate) {
  const percent = Math.round((Number(rate) - 1) * 100) || 0;
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

// The service rejects control characters (vertical tabs are common in text
// copied out of OCR-ed PDFs).
function edgeSafeText(text) {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// JavaScript's Date#toString in UTC, the format the service expects.
function edgeTimestamp(date = new Date()) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${days[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${pad(date.getUTCDate())} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

function edgeCookie() {
  return `muid=${crypto.randomBytes(16).toString("hex").toUpperCase()};`;
}

function buildEdgeSsml(text, voice, rate) {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${voice}'>` +
    `<prosody pitch='+0Hz' rate='${edgeRate(rate)}' volume='+0%'>` +
    edgeSafeText(text) +
    "</prosody></voice></speak>"
  );
}

// Binary frames: a 2-byte big-endian header length, the headers, then audio.
function parseEdgeBinaryFrame(frame) {
  if (frame.length < 2) throw new Error("Edge TTS sent a binary frame without a header length");
  const headerLength = frame.readUInt16BE(0);
  if (headerLength + 2 > frame.length) throw new Error("Edge TTS sent a truncated binary frame");
  const headers = {};
  for (const line of frame
    .subarray(2, 2 + headerLength)
    .toString("utf8")
    .split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) headers[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return { headers, audio: frame.subarray(2 + headerLength) };
}

function parseEdgeTextPath(message) {
  const headerEnd = message.indexOf("\r\n\r\n");
  const head = headerEnd >= 0 ? message.slice(0, headerEnd) : message;
  return head.match(/^Path:(.*)$/m)?.[1]?.trim() ?? null;
}

function edgeRequestOnce(ssml) {
  return new Promise((resolve, reject) => {
    const url =
      `${EDGE_WSS_URL}&ConnectionId=${crypto.randomUUID().replace(/-/g, "")}` +
      `&Sec-MS-GEC=${generateSecMsGec(edgeNowSeconds())}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
    const ws = new WebSocket(url, {
      headers: { ...EDGE_WSS_HEADERS, Cookie: edgeCookie() },
      perMessageDeflate: true,
    });
    const audio = [];
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeAllListeners();
      ws.on("error", () => {});
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("Edge TTS timed out")), EDGE_TIMEOUT_MS);

    ws.on("unexpected-response", (_request, response) => {
      const error = new Error(`Edge TTS refused the connection (${response.statusCode})`);
      error.status = response.statusCode;
      error.serverDate = response.headers?.date;
      finish(error);
    });
    ws.on("open", () => {
      ws.send(
        `X-Timestamp:${edgeTimestamp()}\r\n` +
          "Content-Type:application/json; charset=utf-8\r\n" +
          "Path:speech.config\r\n\r\n" +
          '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
          '"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},' +
          '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
      );
      ws.send(
        `X-RequestId:${crypto.randomUUID().replace(/-/g, "")}\r\n` +
          "Content-Type:application/ssml+xml\r\n" +
          // The trailing Z is what Edge itself sends.
          `X-Timestamp:${edgeTimestamp()}Z\r\n` +
          "Path:ssml\r\n\r\n" +
          ssml
      );
    });
    ws.on("message", (data, isBinary) => {
      try {
        if (!isBinary) {
          if (parseEdgeTextPath(data.toString("utf8")) !== "turn.end") return;
          if (audio.length === 0) throw new Error("Edge TTS returned no audio");
          finish(null, Buffer.concat(audio));
          return;
        }
        const frame = parseEdgeBinaryFrame(Buffer.isBuffer(data) ? data : Buffer.from(data));
        if (frame.headers.Path !== "audio") throw new Error("Edge TTS sent an unexpected frame");
        if (frame.headers["Content-Type"] === "audio/mpeg" && frame.audio.length > 0) {
          audio.push(frame.audio);
        }
      } catch (error) {
        finish(error);
      }
    });
    ws.on("error", (error) => finish(error));
    ws.on("close", () => finish(new Error("Edge TTS closed the connection before finishing")));
  });
}

async function synthesizeEdge(text, { voice = DEFAULT_EDGE_VOICE, rate = 1 } = {}) {
  if (!EDGE_VOICE_PATTERN.test(voice)) throw new Error("Invalid Edge voice");
  const ssml = buildEdgeSsml(text, voice, rate);
  try {
    return await edgeRequestOnce(ssml);
  } catch (error) {
    // A 403 usually means the local clock is outside the token's window;
    // edge-tts corrects by the server's Date header and retries once.
    const serverSeconds = error.serverDate ? Date.parse(error.serverDate) / 1000 : NaN;
    if (error.status !== 403 || !Number.isFinite(serverSeconds)) throw error;
    edgeClockSkewSeconds += serverSeconds - edgeNowSeconds();
    return edgeRequestOnce(ssml);
  }
}

async function listEdgeVoices({ fetchImpl = globalThis.fetch } = {}) {
  if (edgeVoicesCache) return edgeVoicesCache;
  const response = await fetchImpl(
    `${EDGE_VOICE_LIST_URL}&Sec-MS-GEC=${generateSecMsGec(edgeNowSeconds())}` +
      `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`,
    { headers: { ...EDGE_VOICE_HEADERS, Cookie: edgeCookie() } }
  );
  if (!response.ok) throw new Error(`Edge voice list failed (${response.status})`);
  const voices = (await response.json())
    .filter((voice) => EDGE_VOICE_PATTERN.test(voice?.ShortName ?? ""))
    .map((voice) => ({
      name: voice.ShortName,
      locale: voice.Locale,
      gender: voice.Gender,
    }));
  edgeVoicesCache = voices;
  return voices;
}

// gTTS escapes non-ASCII as \uXXXX (json.dumps ensure_ascii); match it.
function asciiJson(value) {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

function buildGoogleRequestBody(text, lang) {
  const parameter = asciiJson([text, lang, null, "null"]);
  const rpc = asciiJson([[[GOOGLE_TTS_RPC, parameter, null, "generic"]]]);
  return `f.req=${encodeURIComponent(rpc)}&`;
}

function parseGoogleAudio(body) {
  const line = body.split("\n").find((candidate) => candidate.includes(GOOGLE_TTS_RPC));
  const match = line?.match(/jQ1olc","\[\\"(.*)\\"]/);
  if (!match) throw new Error("Google TTS returned no audio");
  return Buffer.from(match[1], "base64");
}

async function synthesizeGoogle(text, { lang = "en", fetchImpl = globalThis.fetch } = {}) {
  // MP3 frames concatenate cleanly, which is how gTTS joins its parts too.
  const parts = [];
  for (const part of splitReadAloudText(text, GOOGLE_TTS_MAX_CHARS)) {
    const response = await fetchImpl(GOOGLE_TTS_URL, {
      method: "POST",
      headers: GOOGLE_TTS_HEADERS,
      body: buildGoogleRequestBody(part, lang),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Google TTS failed (${response.status})`);
    parts.push(parseGoogleAudio(await response.text()));
  }
  if (parts.length === 0) throw new Error("Nothing to speak");
  return Buffer.concat(parts);
}

/** MP3 audio for one chunk of read aloud text. */
async function synthesizeReadAloud({ engine, text, voice, rate } = {}) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Nothing to speak");
  if (text.length > MAX_REQUEST_CHARS) throw new Error("Text is too long for one request");
  const safeRate = Math.min(2, Math.max(0.5, Number(rate) || 1));
  if (engine === "edge") return synthesizeEdge(text, { voice, rate: safeRate });
  if (engine === "google") return synthesizeGoogle(text);
  throw new Error(`Unknown read aloud engine: ${engine}`);
}

module.exports = {
  synthesizeReadAloud,
  listEdgeVoices,
  DEFAULT_EDGE_VOICE,
  // Exposed for tests.
  buildEdgeSsml,
  buildGoogleRequestBody,
  edgeRate,
  edgeTimestamp,
  parseEdgeBinaryFrame,
  parseEdgeTextPath,
  parseGoogleAudio,
  synthesizeGoogle,
};
