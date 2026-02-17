"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export default function Home() {
  const [file, setFile] = React.useState<File | null>(null);
  const [text, setText] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onTranscribe() {
    setError(null);
    setText("");
    if (!file) return setError("Selecciona un audio primero.");

    const form = new FormData();
    form.append("file", file);

    setLoading(true);
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falló la transcripción.");
      setText(data.text || "");
    } catch (e: any) {
      setError(e?.message ?? "Error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="space-y-2">
          <CardTitle>Transcripción</CardTitle>
          <div className="flex gap-2">
            <Button asChild variant="secondary">
              <Link href="/realtime">Ir a Realtime (micrófono)</Link>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="audio">Subir audio (.m4a, .mp3, .wav)</Label>
            <Input
              id="audio"
              type="file"
              accept="audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={onTranscribe} disabled={loading || !file}>
              {loading ? "Transcribiendo…" : "Transcribir archivo"}
            </Button>
            <Button variant="outline" onClick={() => (setText(""), setError(null), setFile(null))}>
              Limpiar
            </Button>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Separator />

          <div className="space-y-2">
            <Label>Resultado</Label>
            <Textarea value={text} readOnly rows={12} className="resize-none" />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
