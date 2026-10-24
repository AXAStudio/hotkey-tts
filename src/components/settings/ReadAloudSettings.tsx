import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Button } from "../ui/button";
import { READ_ALOUD_RATE_CHOICES, useSettingsStore } from "../../stores/settingsStore";
import { resolveReadAloudVoice } from "../../utils/readAloud";

// Radix Select reserves "" for "no value", so the system default needs its own value.
const SYSTEM_VOICE_VALUE = "__system__";

// speechSynthesis fills its list asynchronously, so the first read is often empty.
function useSpeechVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(
    () => window.speechSynthesis?.getVoices() ?? []
  );
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

/** Voice and speed rows for the Read Aloud hotkey panel in Settings. */
export default function ReadAloudSettings() {
  const { t } = useTranslation();
  const voices = useSpeechVoices();
  const readAloudVoice = useSettingsStore((s) => s.readAloudVoice);
  const setReadAloudVoice = useSettingsStore((s) => s.setReadAloudVoice);
  const readAloudRate = useSettingsStore((s) => s.readAloudRate);
  const setReadAloudRate = useSettingsStore((s) => s.setReadAloudRate);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  // A saved voice that is no longer installed reads as the system default.
  const selectedVoice = resolveReadAloudVoice(voices, readAloudVoice);
  const voiceValue = selectedVoice ? selectedVoice.voiceURI : SYSTEM_VOICE_VALUE;

  const preview = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const utterance = new SpeechSynthesisUtterance(
      t("settingsPage.general.readAloudHotkey.sample")
    );
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    }
    utterance.rate = readAloudRate;
    synth.cancel();
    synth.speak(utterance);
  };

  return (
    <>
      <SettingsPanelRow>
        <SettingsRow label={t("settingsPage.general.readAloudHotkey.voice")}>
          <div className="flex items-center gap-2">
            <Select
              value={voiceValue}
              onValueChange={(value) =>
                setReadAloudVoice(value === SYSTEM_VOICE_VALUE ? "" : value)
              }
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SYSTEM_VOICE_VALUE}>
                  {t("settingsPage.general.readAloudHotkey.systemVoice")}
                </SelectItem>
                {voices.map((voice) => (
                  <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} ({voice.lang})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={preview}>
              {t("settingsPage.general.readAloudHotkey.preview")}
            </Button>
          </div>
        </SettingsRow>
      </SettingsPanelRow>
      <SettingsPanelRow>
        <SettingsRow label={t("settingsPage.general.readAloudHotkey.speed")}>
          <Select
            value={String(readAloudRate)}
            onValueChange={(value) => setReadAloudRate(Number(value))}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {READ_ALOUD_RATE_CHOICES.map((rate) => (
                <SelectItem key={rate} value={String(rate)}>
                  {t("settingsPage.general.readAloudHotkey.speedOption", { rate })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsPanelRow>
    </>
  );
}
