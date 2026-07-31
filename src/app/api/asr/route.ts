import { type NextRequest, NextResponse } from "next/server";

/**
 * POST /api/asr
 *
 * Accepts multipart/form-data with a single "audio" file field (webm/ogg/mp4/wav).
 * Calls mimo-v2.5-asr via the configured BYOK provider and returns:
 *   { text: string }
 *
 * Auth-free: audio is ephemeral user speech, contains no PII beyond the words spoken.
 */
export async function POST(request: NextRequest) {
  const baseUrl = (process.env.AI_PROVIDER_BASE_URL || "").replace(/\/+$/, "");
  const apiKey  = process.env.AI_PROVIDER_API_KEY || "";

  if (!baseUrl || !apiKey) {
    return NextResponse.json({ error: "ASR provider not configured" }, { status: 503 });
  }

  // ── Read audio blob from multipart form ──────────────────────────────────
  let audioBuffer: ArrayBuffer;
  let mimeType: string;

  try {
    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing audio field" }, { status: 400 });
    }
    audioBuffer = await file.arrayBuffer();
    mimeType = file.type || "audio/webm";
  } catch {
    return NextResponse.json({ error: "Failed to read audio" }, { status: 400 });
  }

  if (audioBuffer.byteLength < 100) {
    return NextResponse.json({ error: "Audio too short" }, { status: 400 });
  }

  // ── Convert to base64 data URI ────────────────────────────────────────────
  const base64 = Buffer.from(audioBuffer).toString("base64");
  const dataUri = `data:${mimeType};base64,${base64}`;

  // ── Call mimo-v2.5-asr ────────────────────────────────────────────────────
  // The ASR model uses the same /v1/chat/completions endpoint but with
  // an `input_audio` content part. Language is set to "auto" so it
  // handles both zh-CN and en-US without extra configuration.
  const body = {
    model: "mimo-v2.5-asr",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: dataUri },
          },
        ],
      },
    ],
    asr_options: { language: "auto" },
  };

  let asrRes: Response;
  try {
    asrRes = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json({ error: `Network error: ${(err as Error).message}` }, { status: 502 });
  }

  if (!asrRes.ok) {
    const errText = await asrRes.text().catch(() => "");
    return NextResponse.json(
      { error: `ASR request failed (${asrRes.status}): ${errText.slice(0, 200)}` },
      { status: asrRes.status }
    );
  }

  // ── Extract transcription text ─────────────────────────────────────────────
  type AsrResponse = {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const json = (await asrRes.json()) as AsrResponse;
  const text = json?.choices?.[0]?.message?.content?.trim() ?? "";

  return NextResponse.json({ text });
}
