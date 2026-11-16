import { useEffect, useRef } from "react";
import type { QaPendingQuestion } from "../../types.js";

const REMINDER_MS = 5 * 60_000;

/** A short rising tone. No network request or desktop notification permission. */
function playChime(audio: AudioContext) {
  const tone = audio.createOscillator();
  const volume = audio.createGain();
  const start = audio.currentTime;
  tone.frequency.setValueAtTime(660, start);
  tone.frequency.setValueAtTime(880, start + 0.12);
  volume.gain.setValueAtTime(0, start);
  volume.gain.linearRampToValueAtTime(0.12, start + 0.02);
  volume.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
  tone.connect(volume);
  volume.connect(audio.destination);
  tone.onended = () => {
    tone.disconnect();
    volume.disconnect();
  };
  tone.start(start);
  tone.stop(start + 0.4);
}

/** All items in a single tool call share one reminder schedule, even while paging the form. */
export function useQuestionSounds(questions: readonly QaPendingQuestion[]) {
  const context = useRef<AudioContext | null>(null);
  const sounded = useRef(new Map<string, number>());
  useEffect(
    () => () => {
      if (context.current) void context.current.close().catch(() => {});
      context.current = null;
    },
    [],
  );

  useEffect(() => {
    if (typeof window.AudioContext !== "function") return;
    let timer: ReturnType<typeof setTimeout>;
    const ids = new Set(questions.map(({ id }) => id));
    for (const id of sounded.current.keys())
      if (!ids.has(id)) sounded.current.delete(id);

    const getAudio = () => {
      try {
        const audio = (context.current ??= new window.AudioContext());
        audio.onstatechange = onStateChange;
        return audio;
      } catch {
        return null; // The form still works without an audio device.
      }
    };
    const tick = () => {
      clearTimeout(timer);
      const now = Date.now();
      let next = Infinity;
      const due: [string, number][] = [];
      for (const { id, createdAt, expiresAt } of questions) {
        if (!Number.isFinite(expiresAt) || now >= expiresAt) continue;
        const slot = Math.max(0, Math.floor((now - createdAt) / REMINDER_MS));
        if ((sounded.current.get(id) ?? -1) < slot) due.push([id, slot]);
        const following = createdAt + (slot + 1) * REMINDER_MS;
        if (following < expiresAt) next = Math.min(next, following);
      }
      if (due.length) {
        const audio = getAudio();
        if (audio?.state === "running") {
          playChime(audio);
          for (const [id, slot] of due) sounded.current.set(id, slot);
        }
      }
      // A throttled background tab plays at most one reminder on waking.
      if (Number.isFinite(next)) timer = setTimeout(tick, next - now);
    };
    function onStateChange() {
      if (context.current?.state === "running") tick();
    }
    const unlock = () => {
      const audio = getAudio();
      if (audio && audio.state !== "running")
        void audio.resume().catch(() => {});
    };
    // Unlock during a real interaction (usually sending the prompt), so a
    // question arriving later can sound even while the tab is in the background.
    window.addEventListener("pointerup", unlock, true);
    window.addEventListener("keydown", unlock, true);
    tick();
    return () => {
      if (context.current) context.current.onstatechange = null;
      clearTimeout(timer);
      window.removeEventListener("pointerup", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, [questions]);
}
