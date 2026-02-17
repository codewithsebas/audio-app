export const runtime = "nodejs";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

export async function POST(req: Request) {
  try {
    const sdpOffer = await req.text();
    if (!sdpOffer?.trim()) {
      return Response.json({ error: "SDP offer vacío." }, { status: 400 });
    }

    const sessionConfig = JSON.stringify({
      type: "transcription",
      audio: {
        input: {
          transcription: {
            model: "whisper-1cribe",
            language: "es",
            // prompt: "Nombres propios / jerga del dominio, si aplica"
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.45,
            prefix_padding_ms: 150,
            silence_duration_ms: 220,
          },
          noise_reduction: { type: "near_field" },
        },
      },
    });

    const fd = new FormData();
    fd.set("sdp", sdpOffer);
    fd.set("session", sessionConfig);

    const r = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: fd,
    });

    if (!r.ok) {
      const errText = await r.text();
      return Response.json(
        { error: `OpenAI error (${r.status}): ${errText}` },
        { status: 500 }
      );
    }

    const sdpAnswer = await r.text();
    return new Response(sdpAnswer, {
      headers: { "Content-Type": "application/sdp" },
    });
  } catch (e: any) {
    return Response.json(
      { error: e?.message ?? "Error creando sesión." },
      { status: 500 }
    );
  }
}
