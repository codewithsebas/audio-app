import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "Falta el archivo 'file'." }, { status: 400 });
    }

    const result = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "es",
    });

    return Response.json({ text: result.text ?? "" });
  } catch (err: any) {
    return Response.json(
      { error: err?.message ?? "Error transcribiendo." },
      { status: 500 }
    );
  }
}
