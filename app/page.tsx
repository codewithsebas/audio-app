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

type Chunk = {
  index: number; // 0..n
  start: number; // seconds
  end: number; // seconds
  text: string;
};

type ApiOk = {
  fullText: string;
  chunks: Chunk[];
};

type ApiErr = {
  error?: string;
};

type State = {
  file: File | null;
  text: string;
  chunks: Chunk[];
  error: string | null;
  phase: Phase;
  progress: number; // 0..100
};

const initialState: State = {
  file: null,
  text: "",
  chunks: [],
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

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${m}:${String(ss).padStart(2, "0")}`;
}

function playDoneSound() {
  try {
    const AudioCtx = (window.AudioContext ||
      (window as any).webkitAudioContext) as typeof AudioContext;
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

function isChunkArray(x: unknown): x is Chunk[] {
  if (!Array.isArray(x)) return false;
  return x.every((c) => {
    if (!c || typeof c !== "object") return false;
    const o = c as any;
    return (
      typeof o.index === "number" &&
      typeof o.start === "number" &&
      typeof o.end === "number" &&
      typeof o.text === "string"
    );
  });
}

export default function FileAudioPage() {
  const [state, setState] = React.useState<State>(initialState);

  // Guard contra doble click real
  const runningRef = React.useRef(false);

  const disabledBusy = state.phase === "uploading" || state.phase === "transcribing";
  const canRun = !!state.file && !disabledBusy && (state.phase === "idle" || state.phase === "done");

  const meta = phaseMeta(state.phase, state.progress);

  const charCount = state.text.length;

  const setFile = (file: File | null) => setState((s) => ({ ...s, file }));
  const setError = (error: string | null) => setState((s) => ({ ...s, error }));
  const setText = (text: string) => setState((s) => ({ ...s, text }));
  const setChunks = (chunks: Chunk[]) => setState((s) => ({ ...s, chunks }));
  const setPhase = (phase: Phase) => setState((s) => ({ ...s, phase }));
  const setProgress = (progress: number) => setState((s) => ({ ...s, progress }));

  function resetAll() {
    runningRef.current = false;
    setState(initialState);
    toast("Limpiado");
  }

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;

    // Limpia salida previa
    setError(null);
    setText("");
    setChunks([]);
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

      const data = (await safeReadJson(res)) as Partial<ApiOk & ApiErr>;

      if (!res.ok) throw new Error(data?.error || `Falló (${res.status}).`);

      // ✅ Espera: { fullText, chunks }
      const fullText = String((data as any)?.fullText ?? "").trim();
      const chunks = isChunkArray((data as any)?.chunks) ? ((data as any).chunks as Chunk[]) : [];

      // Fallback por si backend viejo
      const fallbackText = String((data as any)?.text ?? "").trim(); // tu backend actual
      const finalText = fullText || fallbackText;

      setText(finalText);
      setChunks(chunks);
      setPhase("done");

      playDoneSound();
      setTimeout(playDoneSound, 500);
      setTimeout(playDoneSound, 1000);
      setTimeout(playDoneSound, 1500);

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
    // Si hay chunks, copia en formato por bloques; si no, copia texto plano.
    const payload =
      state.chunks.length > 0
        ? state.chunks
            .map((c) => {
              const header = `[${fmtTime(c.start)}–${fmtTime(c.end)}]`;
              return `${header}\n${(c.text || "").trim()}`;
            })
            .join("\n\n")
        : state.text;

    if (!payload) return;

    try {
      await navigator.clipboard.writeText(payload);
      toast("Copiado");
    } catch {
      toast("No se pudo copiar");
    }
  }

  function clearText() {
    setText("");
    setChunks([]);
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
        <CardHeader className="space-y-1 gap-0">
          <CardTitle className="text-xl font-semibold">Transcribir archivo de audio</CardTitle>
          <div className="text-sm text-muted-foreground">Sube un archivo de audio y transcríbelo en bloques de 15 min.</div>
        </CardHeader>

        <CardContent className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-4">
            {/* Panel archivo */}
            <Card className="rounded-2xl md:col-span-1 py-0 pb-4 gap-0">
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
                  Nota: para que los bloques de 15 min funcionen, el backend debe devolver <code>chunks</code> (verbose_json).
                </div>
              </CardContent>
            </Card>

            {/* Panel texto */}
            <Card className="rounded-2xl py-0 pb-4 md:col-span-2 gap-0">
              <CardHeader className="py-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Resultado</div>

                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{charCount.toLocaleString()} caracteres</Badge>
                    <Badge variant="outline">
                      {state.chunks.length > 0 ? `${state.chunks.length} bloques` : state.text ? "Listo" : "—"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0 space-y-3">
                <ScrollArea className="h-[420px] rounded-lg border bg-muted/30 p-3">
                  {state.chunks.length > 0 ? (
                    <div className="space-y-3">
                      {state.chunks.map((c) => (
                        <div key={c.index} className="rounded-xl border bg-background/40 p-3">
                          <div className="text-xs text-muted-foreground mb-2">
                            Bloque {c.index + 1} · {fmtTime(c.start)}–{fmtTime(c.end)}
                          </div>
                          <pre className="whitespace-pre-wrap leading-7 tracking-[0.2px] text-sm">
                            {c.text || "—"}
                          </pre>
                        </div>
                      ))}
                    </div>
                  ) : state.text ? (
                    <pre className="whitespace-pre-wrap leading-7 tracking-[0.2px] text-sm">{state.text}</pre>
                  ) : (
                    <div className="text-muted-foreground text-sm">Selecciona un archivo y presiona “Subir y transcribir”.</div>
                  )}
                </ScrollArea>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={copyToClipboard} disabled={!state.text && state.chunks.length === 0}>
                    Copiar
                  </Button>
                  <Button variant="outline" onClick={clearText} disabled={(!state.text && state.chunks.length === 0) || disabledBusy}>
                    Vaciar texto
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
