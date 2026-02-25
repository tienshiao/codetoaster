import { useState, useCallback } from "react";

const LS_NOTIFICATION_KEY = "notification-sound";
const LS_BELL_KEY = "bell-sound";

export const SOUND_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "chime", label: "Chime" },
  { value: "bell", label: "Bell" },
  { value: "drop", label: "Drop" },
  { value: "ping", label: "Ping" },
] as const;

export type SoundOption = (typeof SOUND_OPTIONS)[number]["value"];

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playSynthSound(option: SoundOption) {
  if (option === "off") return;

  const ctx = getAudioContext();
  const now = ctx.currentTime;

  switch (option) {
    case "chime": {
      // Two-tone ascending chime
      for (let i = 0; i < 2; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = i === 0 ? 587 : 880; // D5 → A5
        gain.gain.setValueAtTime(0.15, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.3);
      }
      break;
    }
    case "bell": {
      // Metallic bell strike
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 830;
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
      break;
    }
    case "drop": {
      // Descending tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(988, now); // B5
      osc.frequency.exponentialRampToValueAtTime(330, now + 0.25); // E4
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
      break;
    }
    case "ping": {
      // Short high ping
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 1175; // D6
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
      break;
    }
  }
}

/** Reads localStorage and plays the configured notification sound. */
export function playNotificationSound() {
  const option = (localStorage.getItem(LS_NOTIFICATION_KEY) || "off") as SoundOption;
  playSynthSound(option);
}

/** Reads localStorage and plays the configured bell sound. */
export function playBellSound() {
  const option = (localStorage.getItem(LS_BELL_KEY) || "off") as SoundOption;
  playSynthSound(option);
}

function useSoundSetting(key: string) {
  const [soundOption, setSoundOptionState] = useState<SoundOption>(
    () => (localStorage.getItem(key) || "off") as SoundOption,
  );

  const setSoundOption = useCallback((value: SoundOption) => {
    localStorage.setItem(key, value);
    setSoundOptionState(value);
  }, [key]);

  const previewSound = useCallback((value: SoundOption) => {
    playSynthSound(value);
  }, []);

  return { soundOption, setSoundOption, previewSound };
}

/** Hook for the notification sound setting in SettingsDialog. */
export function useNotificationSound() {
  return useSoundSetting(LS_NOTIFICATION_KEY);
}

/** Hook for the bell sound setting in SettingsDialog. */
export function useBellSound() {
  return useSoundSetting(LS_BELL_KEY);
}
