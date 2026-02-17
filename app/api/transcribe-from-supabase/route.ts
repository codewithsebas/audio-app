import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function safeTmpFile(ext: string) {
  const dir = os.tmpdir(); // ✅ cross-platform
  const name = `${crypto.randomUUID()}${ext.startsWith(".") ? ext : `.${ext}`}`;
  return path.join(dir, name);
}

export async function POST(req: Request) {
  try {
    const { bucket, path: objectPath } = await req.json();
    if (!bucket || !objectPath) {
      return Response.json({ error: "Falta bucket o path" }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(objectPath, 60 * 30);

    if (error || !data?.signedUrl) {
      return Response.json(
        { error: error?.message ?? "No se pudo firmar URL" },
        { status: 500 }
      );
    }

    const res = await fetch(data.signedUrl);
    if (!res.ok || !res.body) {
      return Response.json(
        { error: `No se pudo descargar (${res.status})` },
        { status: 500 }
      );
    }

    // ✅ usa tmp real del sistema
    const tmpPath = safeTmpFile(".m4a");

    // Asegura que el directorio existe (en algunos entornos raros)
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });

    await pipeline(res.body as any, fs.createWriteStream(tmpPath));

    const fileStream = fs.createReadStream(tmpPath);

    const result = await openai.audio.transcriptions.create({
      file: fileStream as any,
      model: "gpt-4o-transcribe",
      language: "es",
    });

    // limpieza best-effort
    try {
      fs.unlinkSync(tmpPath);
    } catch {}

    return Response.json({ text: result.text ?? "" });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
