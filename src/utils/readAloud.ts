/**
 * Text as the read aloud hotkey speaks it: line breaks from wrapped selections
 * (PDFs, terminals, hard-wrapped mail) become spaces, so the voice doesn't pause
 * mid-sentence. Returns null when nothing speakable is left.
 */
export function prepareReadAloudText(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed || null;
}

/** The saved voice, or null (the system default) when it is unset or no longer installed. */
export function resolveReadAloudVoice<T extends { voiceURI: string }>(
  voices: readonly T[],
  voiceURI: string
): T | null {
  if (!voiceURI) return null;
  return voices.find((voice) => voice.voiceURI === voiceURI) ?? null;
}
