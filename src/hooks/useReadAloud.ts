import { useEffect } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { createReadAloudPlayer } from "../services/readAloudPlayer";
import { prepareReadAloudText } from "../utils/readAloud";
import logger from "../utils/logger";

/**
 * Speaks the selected text when the read aloud hotkey is pressed, and stops
 * when it is pressed again while speaking (or while the selection is still
 * being copied). Mounted once, in the dictation window, which lives for the
 * whole session. Speech comes from the engine picked in Settings: Microsoft
 * Edge or Google voices online, or the OS voices through speechSynthesis.
 */
export function useReadAloud(): void {
  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI?.onToggleReadAloud || !electronAPI.captureReadAloudText) return;

    const player = createReadAloudPlayer();
    // Bumped on every press, so a capture that resolves after a stop press
    // (or after a newer press) is dropped instead of starting to speak.
    let generation = 0;
    let capturing = false;

    const toggle = async () => {
      const press = ++generation;
      if (capturing || player.isActive()) {
        capturing = false;
        player.stop();
        return;
      }

      capturing = true;
      let capture: Awaited<ReturnType<NonNullable<typeof electronAPI.captureReadAloudText>>>;
      try {
        capture = await electronAPI.captureReadAloudText!();
      } catch (error) {
        logger.warn(
          "Read aloud capture failed",
          { error: error instanceof Error ? error.message : String(error) },
          "readAloud"
        );
        return;
      } finally {
        if (press === generation) capturing = false;
      }
      if (press !== generation) return;

      const text = capture.status === "selected" && "text" in capture ? capture.text : null;
      const speakable = prepareReadAloudText(text);
      if (!speakable) {
        logger.debug(
          "Read aloud found no selected text",
          { status: capture.status, code: "code" in capture ? capture.code : undefined },
          "readAloud"
        );
        return;
      }

      const { readAloudEngine, readAloudVoice, readAloudEdgeVoice, readAloudRate } =
        useSettingsStore.getState();
      void player.speak(speakable, {
        engine: readAloudEngine,
        systemVoiceURI: readAloudVoice,
        edgeVoice: readAloudEdgeVoice,
        rate: readAloudRate,
      });
    };

    const dispose = electronAPI.onToggleReadAloud(() => {
      void toggle();
    });
    return () => {
      generation++;
      dispose?.();
      player.stop();
    };
  }, []);
}
