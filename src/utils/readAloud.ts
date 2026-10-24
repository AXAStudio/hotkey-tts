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

/** "en-US-AndrewMultilingualNeural" → "Andrew Multilingual". */
export function edgeVoiceLabel(shortName: string): string {
  const name = shortName
    .split("-")
    .slice(2)
    .join("-")
    .replace(/Neural$/, "");
  return name.replace(/(?<=[a-z])(?=Multilingual$)/, " ") || shortName;
}

/**
 * Edge voices for the picker: the listed languages only (English plus the UI
 * language), sorted by locale then name. The saved voice always stays listed,
 * even from another language, so the select never shows a blank value.
 */
export function pickEdgeVoices<T extends { name: string; locale: string }>(
  voices: readonly T[],
  languages: readonly string[],
  savedVoice: string
): T[] {
  return voices
    .filter(
      (voice) =>
        voice.name === savedVoice ||
        languages.some((language) => voice.locale.toLowerCase().startsWith(`${language}-`))
    )
    .sort((a, b) => a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name));
}
