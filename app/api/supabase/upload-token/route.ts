import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { filename, contentType } = await req.json();

    if (!filename) {
      return Response.json({ error: "Falta filename" }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const bucket = process.env.SUPABASE_BUCKET_AUDIO!;
    const safeName = String(filename).replace(/[^\w.\-()+ ]/g, "_");
    const path = `uploads/${crypto.randomUUID()}-${safeName}`;

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(path, { upsert: true });

    if (error || !data?.token) {
      return Response.json(
        { error: error?.message ?? "No se pudo crear token" },
        { status: 500 }
      );
    }

    // projectRef para armar el endpoint del storage
    const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];

    return Response.json({
      bucket,
      path,
      token: data.token,
      projectRef,
      contentType: contentType || "audio/m4a",
    });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
