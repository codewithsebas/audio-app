"use client";

import * as React from "react";
import Link from "next/link";
import { uploadAudioResumable } from "@/lib/uploadAudioResumable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Phase = "idle" | "uploading" | "transcribing" | "done";

type State = {
  file: File | null;
  text: string;
  error: string | null;
  phase: Phase;
  progress: number; // 0..100
};

const initialState: State = {
  file: null,
  text: "",
  error: null,
  phase: "idle",
  progress: 0,
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function playDoneSound() {
  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new AudioCtx();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;

    osc.connect(gain);
    gain.connect(ctx.destination);

    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

    osc.start(t);
    osc.stop(t + 0.2);

    osc.onended = () => {
      try {
        ctx.close();
      } catch {}
    };
  } catch {
    // ignore
  }
}

async function safeReadJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function phaseMeta(phase: Phase, progress: number) {
  switch (phase) {
    case "idle":
      return { badge: "Listo", button: "Subir y transcribir", badgeVariant: "outline" as const };
    case "uploading":
      return { badge: `Subiendo… ${progress}%`, button: "Subiendo…", badgeVariant: "secondary" as const };
    case "transcribing":
      return { badge: "Transcribiendo…", button: "Transcribiendo…", badgeVariant: "secondary" as const };
    case "done":
      return { badge: "Completado", button: "Subir y transcribir", badgeVariant: "default" as const };
  }
}

export default function FileAudioPage() {
  const [state, setState] = React.useState<State>(initialState);

  // Guard contra doble click (más fuerte que depender solo de state.phase)
  const runningRef = React.useRef(false);

  const disabledBusy = state.phase === "uploading" || state.phase === "transcribing";
  const canRun = !!state.file && !disabledBusy && (state.phase === "idle" || state.phase === "done");

  const charCount = state.text.length;
  const meta = phaseMeta(state.phase, state.progress);

  const setFile = (file: File | null) => setState((s) => ({ ...s, file }));
  const setError = (error: string | null) => setState((s) => ({ ...s, error }));
  const setText = (text: string) => setState((s) => ({ ...s, text }));
  const setPhase = (phase: Phase) => setState((s) => ({ ...s, phase }));
  const setProgress = (progress: number) => setState((s) => ({ ...s, progress }));

  function resetAll() {
    runningRef.current = false;
    setState(initialState);
    toast("Limpiado");
  }

  async function run() {
    if (runningRef.current) return; // evita doble submit real
    runningRef.current = true;

    setError(null);
    setText("");
    setProgress(0);

    if (!state.file) {
      const msg = "Selecciona un archivo de audio.";
      setError(msg);
      toast(msg);
      runningRef.current = false;
      return;
    }

    try {
      setPhase("uploading");
      toast("Subiendo");

      const { bucket, path } = await uploadAudioResumable(state.file, (pct) => {
        setProgress(pct);
      });

      setPhase("transcribing");
      toast("Transcribiendo");

      const res = await fetch("/api/transcribe-from-supabase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket, path }),
      });

      const data = await safeReadJson(res);
      if (!res.ok) throw new Error(data?.error || `Falló (${res.status}).`);

      const text = String(data?.text ?? "").trim();
      setText(text);
      setPhase("done");

      playDoneSound();
      setTimeout(() => {
        playDoneSound();
      }, 1000);
      setTimeout(() => {
        playDoneSound();
      }, 500);
      setTimeout(() => {
        playDoneSound();
      }, 1500);
      toast("Completado");
    } catch (e: any) {
      const msg = e?.message ?? "Error.";
      setError(msg);
      setPhase("idle");
      toast(msg);
    } finally {
      runningRef.current = false;
    }
  }

  async function copyToClipboard() {
    if (!state.text) return;
    try {
      await navigator.clipboard.writeText(state.text);
      toast("Copiado");
    } catch {
      toast("No se pudo copiar");
    }
  }

  function clearText() {
    setText("");
    toast("Vaciado");
  }

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="outline">
          <Link href="/">← Realtime</Link>
        </Button>

        <Badge variant={meta.badgeVariant}>{meta.badge}</Badge>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="space-y-1">
          <CardTitle>Transcribir archivo largo (Supabase)</CardTitle>
          <div className="text-sm text-muted-foreground">
            Subida resumable (TUS) + transcripción desde Storage. Evita el error 413.
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
            {/* Panel archivo */}
            <Card className="rounded-2xl md:col-span-1 py-0 pb-4">
              <CardHeader className="py-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Archivo</div>
                  <Badge variant="outline">{state.file ? "Cargado" : "Vacío"}</Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-3 pt-0">
                <div className="space-y-2">
                  <Label htmlFor="audio">Seleccionar</Label>
                  <Input
                    id="audio"
                    type="file"
                    accept="audio/*"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    disabled={disabledBusy}
                  />
                </div>

                <Separator />

                <div className="space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Nombre</span>
                    <span className="truncate max-w-[180px] text-right">{state.file?.name ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Tamaño</span>
                    <span>{state.file ? formatBytes(state.file.size) : "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Tipo</span>
                    <span className="truncate max-w-[180px] text-right">{state.file?.type ?? "—"}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  <Button onClick={run} disabled={!canRun} className="flex-1">
                    {meta.button}
                  </Button>

                  <Button variant="outline" onClick={resetAll} disabled={disabledBusy}>
                    Limpiar
                  </Button>
                </div>

                <div className="text-xs text-muted-foreground">
                  Para mejor precisión, añade un <code>prompt</code> en el backend con nombres propios.
                </div>
              </CardContent>
            </Card>

            {/* Panel texto */}
            <Card className="rounded-2xl py-0 pb-4 md:col-span-2">
              <CardHeader className="py-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Texto final</div>

                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{charCount.toLocaleString()} caracteres</Badge>
                    <Badge variant="outline">{state.text ? "Listo" : "—"}</Badge>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0 space-y-3">
                <ScrollArea className="h-[420px] rounded-xl border bg-muted/30 p-6">
                  {state.text ? (
                    <pre className="whitespace-pre-wrap leading-7 tracking-[0.2px] text-sm">
                      {state.text}
                    </pre>
                  ) : (
                    <div className="text-muted-foreground text-sm">
                      Selecciona un archivo y presiona “Subir y transcribir”.
                    </div>
                  )}
                </ScrollArea>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={copyToClipboard} disabled={!state.text}>
                    Copiar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={clearText}
                    disabled={!state.text || disabledBusy}
                  >
                    Vaciar texto
                  </Button>
                </div>

                <div className="text-xs text-muted-foreground">
                  Si el texto sale “pegado”, mejora el audio (menos eco/ruido). Para jerga/nombres propios, usa{" "}
                  <code>prompt</code>.
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
