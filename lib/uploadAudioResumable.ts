import * as tus from "tus-js-client";

type UploadTokenResponse = {
  bucket: string;
  path: string;
  token: string;
  projectRef: string;
  contentType: string;
};

export async function uploadAudioResumable(
  file: File,
  onProgress?: (pct: number) => void
) {
  const r = await fetch("/api/supabase/upload-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });

  const data: UploadTokenResponse = await r.json();
  if (!r.ok) throw new Error((data as any)?.error || "No se pudo crear token");

  const endpoint = `https://${data.projectRef}.storage.supabase.co/storage/v1/upload/resumable`;

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        Authorization: `Bearer ${data.token}`, // ✅ cambio clave
        "x-upsert": "true",
      },
      metadata: {
        bucketName: data.bucket,
        objectName: data.path,
        contentType: data.contentType,
      },
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      onError: (err) => reject(err),
      onProgress: (bytesUploaded, bytesTotal) => {
        const pct = Math.round((bytesUploaded / bytesTotal) * 100);
        onProgress?.(pct);
      },
      onSuccess: () => resolve(),
    });

    upload.start();
  });

  return { bucket: data.bucket, path: data.path };
}
