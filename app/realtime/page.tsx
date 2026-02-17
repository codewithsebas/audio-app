"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

type ConnState = "idle" | "connecting" | "live" | "stopped";

function nowStamp() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function RealtimeTranscribePage() {
  const [state, setState] = React.useState<ConnState>("idle");
  const [paused, setPaused] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // “Live typing”
  const [liveText, setLiveText] = React.useState("");
  // “Final turns”
  const [finalText, setFinalText] = React.useState("");

  const [autoClearLiveOnFinal, setAutoClearLiveOnFinal] = React.useState(true);

  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const dcRef = React.useRef<RTCDataChannel | null>(null);
  const micStreamRef = React.useRef<MediaStream | null>(null);

  // Performance: buffer + RAF flush
  const liveBufRef = React.useRef("");
  const rafRef = React.useRef<number | null>(null);

  // Dedup: some streams send “full so far” instead of incremental delta
  const lastTurnTextRef = React.useRef("");

  function scheduleFlush() {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!liveBufRef.current) return;
      const chunk = liveBufRef.current;
      liveBufRef.current = "";
      setLiveText((prev) => prev + chunk);
    });
  }

  function appendSmart(next: string) {
    const prev = lastTurnTextRef.current;
    if (!prev) {
      lastTurnTextRef.current = next;
      return next;
    }
    if (next.startsWith(prev)) {
      const diff = next.slice(prev.length);
      lastTurnTextRef.current = next;
      return diff;
    }
    // fallback: avoid duplication explosions
    lastTurnTextRef.current = next;
    return "\n" + next;
  }

  function hardResetText() {
    setLiveText("");
    setFinalText("");
    liveBufRef.current = "";
    lastTurnTextRef.current = "";
  }

  function finalizeLiveIfAny(reason: string) {
    const live = (liveText + liveBufRef.current).trim();
    liveBufRef.current = "";
    lastTurnTextRef.current = "";

    if (!live) {
      setLiveText("");
      return;
    }

    const stamp = nowStamp();
    setFinalText((prev) => {
      const block = `[${stamp}] ${reason}\n${live}`;
      return prev ? `${prev}\n\n${block}` : block;
    });

    setLiveText("");
  }

  async function start() {
    setError(null);
    hardResetText();
    setPaused(false);
    setState("connecting");

    try {
      // Mic
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = ms;

      // PeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Add mic track
      const track = ms.getAudioTracks()[0];
      pc.addTrack(track);

      // Events channel
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => setState("live");
      dc.onclose = () => setState("stopped");
      dc.onerror = () => setError("Fallo en el data channel.");

      dc.onmessage = (ev) => {
        // fast reject
        if (typeof ev.data !== "string" || ev.data[0] !== "{") return;
        if (paused) return; // if paused, ignore text updates

        try {
          const msg = JSON.parse(ev.data);
          const t = msg?.type;

          if (t === "conversation.item.input_audio_transcription.delta") {
            const incoming = msg?.delta ?? msg?.transcript ?? "";
            if (typeof incoming === "string" && incoming.length) {
              const diff = appendSmart(incoming);
              liveBufRef.current += diff;
              scheduleFlush();
            }
          }

          if (t === "conversation.item.input_audio_transcription.completed") {
            const transcript = msg?.transcript ?? "";
            if (typeof transcript === "string" && transcript.trim().length) {
              const stamp = nowStamp();
              setFinalText((prev) => {
                const block = `[${stamp}]\n${transcript.trim()}`;
                return prev ? `${prev}\n\n${block}` : block;
              });
              lastTurnTextRef.current = "";
              liveBufRef.current = "";
              if (autoClearLiveOnFinal) setLiveText("");
            }
          }
        } catch {
          // ignore
        }
      };

      // Offer -> server -> answer
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
      // live now
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

    // finalize whatever is pending
    // (don’t label as pause; just close)
    const pending = (liveText + liveBufRef.current).trim();
    if (pending) finalizeLiveIfAny("Detenido");
  }

  function togglePause() {
    const track = micStreamRef.current?.getAudioTracks()?.[0];
    if (!track) return;

    const nextPaused = !paused;
    // mute/unmute mic instantly
    track.enabled = !nextPaused;
    setPaused(nextPaused);

    if (nextPaused) {
      // finalize current buffer so it doesn't keep accumulating junk
      finalizeLiveIfAny("Pausa");
    }
  }

  function addMarker() {
    const stamp = nowStamp();
    setFinalText((prev) => (prev ? `${prev}\n\n[${stamp}] — MARCA —` : `[${stamp}] — MARCA —`));
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
          {state === "live" && (paused ? "Pausado" : "En vivo")}
          {state === "stopped" && "Detenido"}
        </Badge>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="space-y-2">
          <CardTitle>Realtime (micrófono) — transcripción instantánea</CardTitle>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button size="lg" onClick={canStop ? stop : start} disabled={!canStart && !canStop}>
                {canStop ? "Detener" : state === "connecting" ? "Iniciando…" : "Iniciar"}
              </Button>

              <Button
                size="lg"
                variant="secondary"
                onClick={togglePause}
                disabled={!canPause}
                aria-disabled={!canPause}
              >
                {paused ? "Reanudar" : "Pausar"}
              </Button>

              <Button variant="outline" onClick={addMarker} disabled={state !== "live"}>
                Marcar
              </Button>

              <Button variant="outline" onClick={() => hardResetText()} disabled={state === "connecting"}>
                Limpiar
              </Button>

              <Button variant="outline" onClick={copyFinal} disabled={!finalText}>
                Copiar final
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Auto-limpiar “en vivo”</span>
              <Switch checked={autoClearLiveOnFinal} onCheckedChange={setAutoClearLiveOnFinal} />
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

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="rounded-2xl">
              <CardHeader className="py-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">En vivo</div>
                  <Badge variant="outline">{paused ? "Pausa" : "Typing"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <ScrollArea className="h-[280px] rounded-md border p-3">
                  <pre className="whitespace-pre-wrap text-sm leading-6">
                    {liveText}
                    {state === "live" && !paused ? "▍" : ""}
                  </pre>
                </ScrollArea>
                <div className="mt-2 text-xs text-muted-foreground">
                  Mejor rendimiento: buffer + flush por frame (menos lag).
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="py-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Final</div>
                  <Badge variant="outline">Por bloques</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <ScrollArea className="h-[280px] rounded-md border p-3">
                  <pre className="whitespace-pre-wrap text-sm leading-6">
                    {finalText || "—"}
                  </pre>
                </ScrollArea>
                <div className="mt-2 text-xs text-muted-foreground">
                  Pausa corta el audio (track.enabled=false) para evitar transcribir ruido.
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
