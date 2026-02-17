import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const execFileAsync = promisify(execFile);
const FFMPEG_CMD =
  process.env.FFMPEG_PATH?.trim() ||
  (process.platform === "win32" ? "C:\\ffmpeg\\bin\\ffmpeg.exe" : "ffmpeg");


function safeTmpFile(ext: string) {
  const dir = os.tmpdir();
  const name = `${crypto.randomUUID()}${ext.startsWith(".") ? ext : `.${ext}`}`;
  return path.join(dir, name);
}

async function segmentAudio(inputPath: string, segmentSeconds = 15 * 60) {
  if (process.platform === "win32" && !fs.existsSync(FFMPEG_CMD)) {
    throw new Error(`No encuentro ffmpeg en: ${FFMPEG_CMD}`);
  }

  const outDir = path.join(os.tmpdir(), `seg-${crypto.randomUUID()}`);
  fs.mkdirSync(outDir, { recursive: true });

  const outPattern = path.join(outDir, "chunk-%03d.mp3");

  await execFileAsync(FFMPEG_CMD, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    "-f",
    "segment",
    "-segment_time",
    String(segmentSeconds),
    "-reset_timestamps",
    "1",
    outPattern,
  ]);

  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith("chunk-") && f.endsWith(".mp3"))
    .sort()
    .map((f) => path.join(outDir, f));

  if (files.length === 0) throw new Error("No se generaron segmentos.");

  return { outDir, files, segmentSeconds };
}


export async function POST(req: Request) {
  let tmpPath: string | null = null;
  let segDir: string | null = null;

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

    tmpPath = safeTmpFile(".m4a");
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    await pipeline(res.body as any, fs.createWriteStream(tmpPath));

    // 1) Segmentar (15 min)
    const { outDir, files, segmentSeconds } = await segmentAudio(tmpPath, 15 * 60);
    segDir = outDir;

    // 2) Transcribir chunks y unir
    const chunks: Array<{ index: number; start: number; end: number; text: string }> = [];
    const texts: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const fileStream = fs.createReadStream(filePath);

      const tr: any = await openai.audio.transcriptions.create({
        file: fileStream as any,
        model: "whisper-1",
        language: "es",
        response_format: "verbose_json",
      });

      const offset = i * segmentSeconds;

      const segs = Array.isArray(tr?.segments) ? tr.segments : [];
      const segText = String(tr?.text ?? "").trim();
      texts.push(segText);

      if (segs.length > 0) {
        const joined = segs
          .map((s: any) => String(s?.text ?? "").trim())
          .join(" ")
          .trim();

        chunks.push({
          index: i,
          start: offset,
          end: offset + segmentSeconds,
          text: joined || segText || "",
        });
      } else {
        chunks.push({
          index: i,
          start: offset,
          end: offset + segmentSeconds,
          text: segText || "",
        });
      }
    }

    const fullText = texts.join("\n\n").trim();
    return Response.json({ fullText, chunks });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Error" }, { status: 500 });
  } finally {
    try {
      if (tmpPath) fs.unlinkSync(tmpPath);
    } catch {}
    try {
      if (segDir) fs.rmSync(segDir, { recursive: true, force: true });
    } catch {}
  }
}
