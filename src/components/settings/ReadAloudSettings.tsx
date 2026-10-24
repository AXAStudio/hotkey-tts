import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Button } from "../ui/button";
import {
  READ_ALOUD_ENGINES,
  READ_ALOUD_RATE_CHOICES,
  useSettingsStore,
  type ReadAloudEngine,
} from "../../stores/settingsStore";
import { createReadAloudPlayer } from "../../services/readAloudPlayer";
import { edgeVoiceLabel, pickEdgeVoices, resolveReadAloudVoice } from "../../utils/readAloud";

// Radix Select reserves "" for "no value", so the system default needs its own value.
const SYSTEM_VOICE_VALUE = "__system__";

const ENGINE_LABEL_KEYS: Record<ReadAloudEngine, string> = {
  edge: "settingsPage.general.readAloudHotkey.engineEdge",
  google: "settingsPage.general.readAloudHotkey.engineGoogle",
  system: "settingsPage.general.readAloudHotkey.engineSystem",
};

// Who receives the selected text for each online engine (brand names, not translated).
const ENGINE_PROVIDERS: Partial<Record<ReadAloudEngine, string>> = {
  edge: "Microsoft",
  google: "Google",
};

type EdgeVoice = { name: string; locale: string; gender: string };

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

// The Edge list comes from Microsoft, so it is fetched only once that engine is picked.
function useEdgeVoices(enabled: boolean): EdgeVoice[] | "loading" | "error" {
  const [state, setState] = useState<EdgeVoice[] | "loading" | "error">("loading");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState("loading");
    window.electronAPI
      ?.getReadAloudEdgeVoices?.()
      .then((result) => {
        if (!cancelled) setState(result?.success ? result.voices : "error");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return state;
}

/** Engine, voice and speed rows for the Read Aloud hotkey panel in Settings. */
export default function ReadAloudSettings() {
  const { t, i18n } = useTranslation();
  const engine = useSettingsStore((s) => s.readAloudEngine);
  const setEngine = useSettingsStore((s) => s.setReadAloudEngine);
  const systemVoiceURI = useSettingsStore((s) => s.readAloudVoice);
  const setSystemVoice = useSettingsStore((s) => s.setReadAloudVoice);
  const edgeVoice = useSettingsStore((s) => s.readAloudEdgeVoice);
  const setEdgeVoice = useSettingsStore((s) => s.setReadAloudEdgeVoice);
  const rate = useSettingsStore((s) => s.readAloudRate);
  const setRate = useSettingsStore((s) => s.setReadAloudRate);

  const systemVoices = useSpeechVoices();
  const edgeVoices = useEdgeVoices(engine === "edge");
  const [player] = useState(createReadAloudPlayer);
  useEffect(() => () => player.stop(), [player]);

  // A saved voice that is no longer installed reads as the system default.
  const selectedSystemVoice = resolveReadAloudVoice(systemVoices, systemVoiceURI);
  const systemVoiceValue = selectedSystemVoice?.voiceURI ?? SYSTEM_VOICE_VALUE;

  const uiLanguage = (i18n.language || "en").split("-")[0].toLowerCase();
  const edgeVoiceOptions = useMemo(() => {
    const listed = Array.isArray(edgeVoices)
      ? pickEdgeVoices(edgeVoices, ["en", uiLanguage], edgeVoice)
      : [];
    return listed.some((voice) => voice.name === edgeVoice)
      ? listed
      : [
          { name: edgeVoice, locale: edgeVoice.split("-").slice(0, 2).join("-"), gender: "" },
          ...listed,
        ];
  }, [edgeVoices, uiLanguage, edgeVoice]);

  const preview = () => {
    void player.speak(t("settingsPage.general.readAloudHotkey.sample"), {
      engine,
      systemVoiceURI,
      edgeVoice,
      rate,
    });
  };

  const provider = ENGINE_PROVIDERS[engine];

  return (
    <>
      <SettingsPanelRow>
        <SettingsRow
          label={t("settingsPage.general.readAloudHotkey.engine")}
          description={
            provider
              ? t("settingsPage.general.readAloudHotkey.onlineNote", { provider })
              : undefined
          }
        >
          <Select value={engine} onValueChange={(value) => setEngine(value as ReadAloudEngine)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {READ_ALOUD_ENGINES.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(ENGINE_LABEL_KEYS[option])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsPanelRow>
      <SettingsPanelRow>
        <SettingsRow
          label={t("settingsPage.general.readAloudHotkey.voice")}
          description={
            engine === "edge" && edgeVoices === "error"
              ? t("settingsPage.general.readAloudHotkey.voicesUnavailable")
              : undefined
          }
        >
          <div className="flex items-center gap-2">
            {engine === "edge" && (
              <Select value={edgeVoice} onValueChange={setEdgeVoice}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {edgeVoiceOptions.map((voice) => (
                    <SelectItem key={voice.name} value={voice.name}>
                      {edgeVoiceLabel(voice.name)} ({voice.locale})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {engine === "system" && (
              <Select
                value={systemVoiceValue}
                onValueChange={(value) => setSystemVoice(value === SYSTEM_VOICE_VALUE ? "" : value)}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SYSTEM_VOICE_VALUE}>
                    {t("settingsPage.general.readAloudHotkey.systemVoice")}
                  </SelectItem>
                  {systemVoices.map((voice) => (
                    <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} ({voice.lang})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" onClick={preview}>
              {t("settingsPage.general.readAloudHotkey.preview")}
            </Button>
          </div>
        </SettingsRow>
      </SettingsPanelRow>
      <SettingsPanelRow>
        <SettingsRow label={t("settingsPage.general.readAloudHotkey.speed")}>
          <Select value={String(rate)} onValueChange={(value) => setRate(Number(value))}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {READ_ALOUD_RATE_CHOICES.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {t("settingsPage.general.readAloudHotkey.speedOption", { rate: choice })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsPanelRow>
    </>
  );
}
