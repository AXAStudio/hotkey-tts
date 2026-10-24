const test = require("node:test");
const assert = require("node:assert/strict");
const { generateSecMsGec } = require("../../src/helpers/edgeTtsToken");

// Generated with edge-tts 7.3.1: edge_tts.drm.generate_sec_ms_gec_v2(timestamp)
const EDGE_TTS_TOKENS = [
  [0, "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6"],
  [1700000000, "2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2"],
  [
    1729790123.456,
    "34DD2205894FD0B7-376364521FC05D972232EAB727C60FAD8B3781D3E7CBED589B266DE1FECA1EDA",
  ],
  [
    1792848000.9,
    "216195897BD0BB0D-D794D36CBF0983E0EA25FCB2C50D81004CCA6AA94F21B12B0171AF977E8EE2D2",
  ],
  [
    1800000299.999,
    "99E54519B490BE5C-E162DB0977FBDCB9B86DD8148BF1BCDC3C0303176CE39852A42B415935C20654",
  ],
];

test("Sec-MS-GEC matches edge-tts for the same time", () => {
  for (const [timestamp, expected] of EDGE_TTS_TOKENS) {
    assert.equal(generateSecMsGec(timestamp), expected, `timestamp ${timestamp}`);
  }
});

test("Sec-MS-GEC is stable within a 5-minute window and changes across it", () => {
  assert.equal(generateSecMsGec(1800000000), generateSecMsGec(1800000299.999));
  assert.notEqual(generateSecMsGec(1800000299.999), generateSecMsGec(1800000300));
});
