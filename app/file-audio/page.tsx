// app/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

export default function UploadTranscribePage() {
    const [file, setFile] = React.useState<File | null>(null);
    const [finalText, setFinalText] = React.useState("");
    const [state, setState] = React.useState<"idle" | "uploading" | "done">("idle");
    const [error, setError] = React.useState<string | null>(null);

    const canTranscribe = !!file && state !== "uploading";

    function resetAll() {
        setError(null);
        setFinalText("");
        setFile(null);
        setState("idle");
    }

    async function transcribe() {
        setError(null);
        setFinalText("");

        if (!file) {
            setError("Selecciona un archivo de audio.");
            return;
        }

        const form = new FormData();
        form.append("file", file);

        setState("uploading");
        try {
            const res = await fetch("/api/transcribe", {
                method: "POST",
                body: form,
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `Falló la transcripción (${res.status}).`);

            setFinalText((data?.text || "").trim());
            setState("done");
        } catch (e: any) {
            setError(e?.message ?? "Error transcribiendo.");
            setState("idle");
        }
    }

    const badgeVariant =
        state === "uploading" ? "secondary" : state === "done" ? "default" : "outline";

    return (
        <main className="mx-auto max-w-4xl p-6 space-y-4">
            <div className="flex items-center justify-between">
                <Button asChild variant="outline">
                    <Link href="/">Ir a Realtime →</Link>
                </Button>
                <Badge variant={badgeVariant}>
                    {state === "idle" && "Listo"}
                    {state === "uploading" && "Transcribiendo…"}
                    {state === "done" && "Completado"}
                </Badge>
            </div>

            <Card className="rounded-2xl">
                <CardHeader className="space-y-1">
                    <CardTitle>Transcribir archivo de audio</CardTitle>
                    <div className="text-sm text-muted-foreground">
                        Sube un audio y obtén el texto final. Evita ruido y recortes para mejorar precisión.
                    </div>
                </CardHeader>

                <CardContent className="space-y-4">
                    {error && (
                        <Alert variant="destructive">
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
                        <Card className="rounded-2xl md:col-span-1 py-0 pb-4">
                            <CardHeader className="py-4">
                                <div className="flex items-center justify-between">
                                    <div className="font-medium">Archivo</div>
                                    <Badge variant="outline">{file ? "Cargado" : "Vacío"}</Badge>
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
                                        disabled={state === "uploading"}
                                    />
                                </div>

                                <Separator />

                                <div className="space-y-1 text-sm">
                                    <div className="flex justify-between gap-3">
                                        <span className="text-muted-foreground">Nombre</span>
                                        <span className="truncate max-w-[180px] text-right">
                                            {file?.name ?? "—"}
                                        </span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <span className="text-muted-foreground">Tamaño</span>
                                        <span>{file ? formatBytes(file.size) : "—"}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <span className="text-muted-foreground">Tipo</span>
                                        <span className="truncate max-w-[180px] text-right">
                                            {file?.type ?? "—"}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex flex-col flex-wrap gap-2 pt-2">
                                    <Button onClick={transcribe} disabled={!canTranscribe} className="flex-1">
                                        {state === "uploading" ? "Procesando…" : "Transcribir"}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={resetAll}
                                        disabled={state === "uploading"}
                                    >
                                        Limpiar
                                    </Button>
                                </div>

                                <div className="text-xs text-muted-foreground">
                                    Si el audio tiene nombres propios, mejora el resultado agregando un <code>prompt</code> en el backend.
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="rounded-2xl py-0 pb-4 md:col-span-2">
                            <CardHeader className="py-4">
                                <div className="flex items-center justify-between">
                                    <div className="font-medium">Texto final</div>
                                    <Badge variant="outline">{finalText ? "Listo" : "—"}</Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-3">
                                <ScrollArea className="h-[420px] rounded-md border p-3">
                                    <pre className="whitespace-pre-wrap text-sm leading-6">
                                        {finalText || "Sube un archivo y presiona “Transcribir”."}
                                    </pre>
                                </ScrollArea>

                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="outline"
                                        onClick={async () => navigator.clipboard.writeText(finalText)}
                                        disabled={!finalText}
                                    >
                                        Copiar
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => setFinalText("")}
                                        disabled={!finalText || state === "uploading"}
                                    >
                                        Vaciar texto
                                    </Button>
                                </div>

                                <div className="text-xs text-muted-foreground">
                                    Consejo: audios con eco o calle reducen precisión. Si puedes, usa un micrófono cercano.
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </CardContent>
            </Card>
        </main>
    );
}
