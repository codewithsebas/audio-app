"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

type ConnState = "idle" | "connecting" | "live" | "stopped";

function joinSegments(segments: string[]) {
  // Une segmentos con separación razonable; evita doble espacio y líneas vacías
  return segments
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

export default function RealtimeTranscribePage() {
  const [state, setState] = React.useState<ConnState>("idle");
  const [paused, setPaused] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Guardamos segmentos finales (por turnos)
  const segmentsRef = React.useRef<string[]>([]);
  const [finalText, setFinalText] = React.useState("");

  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const dcRef = React.useRef<RTCDataChannel | null>(null);
  const micStreamRef = React.useRef<MediaStream | null>(null);

  // Evita setState por cada evento si llegan varios seguidos
  const flushTimerRef = React.useRef<number | null>(null);

  function scheduleFinalFlush() {
    if (flushTimerRef.current) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      setFinalText(joinSegments(segmentsRef.current));
    }, 60); // pequeño debounce para agrupar renders
  }

  function resetAll() {
    setError(null);
    setFinalText("");
    segmentsRef.current = [];
  }

  async function start() {
    setError(null);
    resetAll();
    setPaused(false);
    setState("connecting");

    try {
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = ms;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.addTrack(ms.getAudioTracks()[0]);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => setState("live");
      dc.onclose = () => setState("stopped");
      dc.onerror = () => setError("Fallo en el data channel.");

      dc.onmessage = (ev) => {
        if (paused) return;
        if (typeof ev.data !== "string" || ev.data[0] !== "{") return;

        try {
          const msg = JSON.parse(ev.data);
          const t = msg?.type;

          // SOLO final; ignoramos deltas para evitar ruido/render extra
          if (t === "conversation.item.input_audio_transcription.completed") {
            const transcript = msg?.transcript ?? "";
            if (typeof transcript === "string" && transcript.trim()) {
              segmentsRef.current.push(transcript.trim());
              scheduleFinalFlush();
            }
          }
        } catch {
          // ignore
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const r = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
      });

      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.error || `Error creando sesión (${r.status}).`);
      }

      const answerSdp = await r.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (e: any) {
      setError(e?.message ?? "Error iniciando.");
      stop();
    }
  }

  function stop() {
    setState("stopped");
    setPaused(false);

    try {
      dcRef.current?.close();
    } catch {}
    dcRef.current = null;

    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    try {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    micStreamRef.current = null;

    // flush final inmediato al detener
    setFinalText(joinSegments(segmentsRef.current));
  }

  function togglePause() {
    const track = micStreamRef.current?.getAudioTracks()?.[0];
    if (!track) return;

    const nextPaused = !paused;
    track.enabled = !nextPaused; // pausa real (mute)
    setPaused(nextPaused);

    // si pausas, hacemos flush para que quede consistente
    if (nextPaused) setFinalText(joinSegments(segmentsRef.current));
  }

  function addMarker() {
    segmentsRef.current.push("— — —");
    setFinalText(joinSegments(segmentsRef.current));
  }

  async function copyFinal() {
    await navigator.clipboard.writeText(finalText || "");
  }

  const badgeVariant =
    state === "live" ? "default" : state === "connecting" ? "secondary" : "outline";

  const canStart = state !== "connecting" && state !== "live";
  const canStop = state === "live";
  const canPause = state === "live";

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="outline">
          <Link href="/">← Volver</Link>
        </Button>

        <Badge variant={badgeVariant}>
          {state === "idle" && "Listo"}
          {state === "connecting" && "Conectando…"}
          {state === "live" && (paused ? "Pausado" : "Grabando")}
          {state === "stopped" && "Detenido"}
        </Badge>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="space-y-2">
          <CardTitle>Realtime — texto final</CardTitle>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" onClick={canStop ? stop : start} disabled={!canStart && !canStop}>
                {canStop ? "Detener" : state === "connecting" ? "Iniciando…" : "Iniciar"}
              </Button>

              <Button
                size="lg"
                variant="secondary"
                onClick={togglePause}
                disabled={!canPause}
              >
                {paused ? "Reanudar" : "Pausar"}
              </Button>

              <Button variant="outline" onClick={addMarker} disabled={state !== "live"}>
                Marcar
              </Button>

              <Button variant="outline" onClick={resetAll} disabled={state === "connecting"}>
                Limpiar
              </Button>

              <Button variant="outline" onClick={copyFinal} disabled={!finalText}>
                Copiar
              </Button>
            </div>

            <div className="text-sm text-muted-foreground">
              Se guarda solo lo <b>finalizado</b> por turnos (sin texto “en vivo”).
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Separator />

          <ScrollArea className="h-[420px] rounded-md border p-3">
            <pre className="whitespace-pre-wrap text-sm leading-3.5">
              {finalText || "—"}
            </pre>
          </ScrollArea>

          <div className="text-xs text-muted-foreground">
            Pausa = no se captura audio. Si necesitas más precisión.
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
