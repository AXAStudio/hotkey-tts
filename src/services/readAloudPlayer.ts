import { splitReadAloudText } from "../helpers/readAloudChunks.js";
import type { ReadAloudEngine } from "../stores/settingsStore";
import { resolveReadAloudVoice } from "../utils/readAloud";
import logger from "../utils/logger";

export interface ReadAloudSpeechOptions {
  engine: ReadAloudEngine;
  /** voiceURI for the system engine; "" is the system default. */
  systemVoiceURI: string;
  /** Short name for the Edge engine, e.g. en-US-ChristopherNeural. */
  edgeVoice: string;
  rate: number;
}

export interface ReadAloudPlayer {
  /** Stops anything already playing, then speaks; resolves when done or stopped. */
  speak: (text: string, options: ReadAloudSpeechOptions) => Promise<void>;
  stop: () => void;
  isActive: () => boolean;
}

// Small enough that the first chunk comes back in about a second; later
// chunks are fetched while the previous one plays.
const ONLINE_CHUNK_CHARS = 400;

export function createReadAloudPlayer(): ReadAloudPlayer {
  // Bumped by every stop, so a chunk that arrives after a stop never plays.
  let session = 0;
  let active = false;
  let cancelCurrent: (() => void) | null = null;

  const stop = () => {
    session += 1;
    active = false;
    cancelCurrent?.();
    cancelCurrent = null;
    window.speechSynthesis?.cancel();
  };

  const speakSystem = (text: string, options: ReadAloudSpeechOptions, id: number) =>
    new Promise<void>((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth || id !== session) {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = resolveReadAloudVoice(synth.getVoices(), options.systemVoiceURI);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      utterance.rate = options.rate;
      utterance.onend = () => resolve();
      utterance.onerror = (event) => {
        if (event.error !== "canceled" && event.error !== "interrupted") {
          logger.warn("Read aloud speech failed", { error: event.error }, "readAloud");
        }
        resolve();
      };
      cancelCurrent = () => {
        synth.cancel();
        resolve();
      };
      synth.cancel();
      synth.speak(utterance);
    });

  const playMp3 = (audioBytes: Uint8Array, playbackRate: number) =>
    new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([audioBytes as BlobPart], { type: "audio/mpeg" }));
      const audio = new Audio(url);
      audio.playbackRate = playbackRate;
      const finish = (error?: unknown) => {
        URL.revokeObjectURL(url);
        audio.onended = null;
        audio.onerror = null;
        if (error) reject(error);
        else resolve();
      };
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error("Audio playback failed"));
      cancelCurrent = () => {
        audio.pause();
        finish();
      };
      audio.play().catch((error) => finish(error));
    });

  const speakOnline = async (text: string, options: ReadAloudSpeechOptions, id: number) => {
    const synthesize = window.electronAPI?.synthesizeReadAloud;
    const engine = options.engine;
    if (!synthesize || engine === "system") return speakSystem(text, options, id);

    const chunks = splitReadAloudText(text, ONLINE_CHUNK_CHARS);
    const request = (chunk: string) =>
      synthesize({ engine, text: chunk, voice: options.edgeVoice, rate: options.rate }).catch(
        (error: unknown) => ({
          success: false as const,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    // Edge speeds its voice up itself (SSML prosody); Google's only plays faster.
    const playbackRate = engine === "google" ? options.rate : 1;

    let next = chunks.length > 0 ? request(chunks[0]) : null;
    for (let index = 0; index < chunks.length && next; index += 1) {
      const result = await next;
      if (id !== session) return;
      next = index + 1 < chunks.length ? request(chunks[index + 1]) : null;
      try {
        if ("error" in result) throw new Error(result.error);
        await playMp3(result.audio, playbackRate);
      } catch (error) {
        if (id !== session) return;
        // Offline, or the service changed: finish with the system voice
        // rather than going silent.
        logger.warn(
          "Online read aloud failed; using the system voice",
          { engine, error: error instanceof Error ? error.message : String(error) },
          "readAloud"
        );
        return speakSystem(chunks.slice(index).join(" "), options, id);
      }
      if (id !== session) return;
    }
  };

  const speak = async (text: string, options: ReadAloudSpeechOptions) => {
    stop();
    const id = session;
    active = true;
    try {
      if (options.engine === "system") await speakSystem(text, options, id);
      else await speakOnline(text, options, id);
    } finally {
      if (id === session) {
        active = false;
        cancelCurrent = null;
      }
    }
  };

  return { speak, stop, isActive: () => active };
}
