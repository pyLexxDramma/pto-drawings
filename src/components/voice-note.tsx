"use client";

import { useRef, useState } from "react";
import { IconMic } from "@/components/tool-icons";

type VoiceNoteButtonProps = {
  onText: (text: string) => void;
};

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function speechCtor(): (new () => SpeechRec) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceNoteButton({ onText }: VoiceNoteButtonProps) {
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [hint, setHint] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speechRef = useRef<SpeechRec | null>(null);

  function stopSpeech() {
    speechRef.current?.stop();
    speechRef.current = null;
  }

  async function transcribeBlob(blob: Blob) {
    const form = new FormData();
    form.set("audio", blob, "note.webm");
    const response = await fetch("/api/transcribe", { method: "POST", body: form });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { text?: string };
    const text = payload.text?.trim();
    if (!text) throw new Error("Пустая расшифровка");
    onText(text);
  }

  function startBrowserSpeech() {
    const Ctor = speechCtor();
    if (!Ctor) {
      setHint("Нет микрофона и нет Whisper на бэке");
      setState("idle");
      return;
    }
    const rec = new Ctor();
    rec.lang = "ru-RU";
    rec.interimResults = false;
    rec.onresult = (event) => {
      const text = Array.from(event.results)
        .map((item) => item[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (text) onText(text);
    };
    rec.onerror = () => setHint("Речь не распознана");
    rec.onend = () => {
      setState("idle");
      speechRef.current = null;
    };
    speechRef.current = rec;
    rec.start();
    setState("rec");
    setHint("Говорите… ещё раз — стоп");
  }

  async function toggle() {
    if (state === "busy") return;
    if (state === "rec") {
      mediaRef.current?.stop();
      mediaRef.current = null;
      stopSpeech();
      setState("idle");
      setHint(null);
      return;
    }

    setHint(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      if (speechCtor()) {
        startBrowserSpeech();
        return;
      }
      setHint("Нет микрофона и нет Whisper на бэке");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 200) {
          setState("idle");
          setHint("Слишком коротко");
          return;
        }
        setState("busy");
        void transcribeBlob(blob)
          .then(() => {
            setHint(null);
            setState("idle");
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : "";
            if (
              message.includes("не подключён") ||
              message.includes("404") ||
              message.includes("501") ||
              message.includes("502")
            ) {
              if (speechCtor()) {
                startBrowserSpeech();
                return;
              }
            }
            setHint(message || "Не удалось расшифровать");
            setState("idle");
          });
      };
      mediaRef.current = recorder;
      recorder.start();
      setState("rec");
      setHint("Запись… ещё раз — стоп");
    } catch {
      startBrowserSpeech();
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void toggle()}
        title="Наговорить замечание"
        aria-pressed={state === "rec"}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs ${
          state === "rec"
            ? "border-red-500 bg-red-50 text-red-700"
            : "border-slate-300 bg-white text-text hover:bg-slate-50"
        }`}
      >
        <IconMic className={state === "busy" ? "animate-pulse" : undefined} />
        <span className="sr-only">
          {state === "rec" ? "Остановить запись" : "Наговорить замечание"}
        </span>
      </button>
      {hint ? <span className="text-[10px] text-muted">{hint}</span> : null}
    </span>
  );
}
