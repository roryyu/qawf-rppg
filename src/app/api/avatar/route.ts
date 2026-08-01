import { type NextRequest, NextResponse } from "next/server";

/**
 * POST /api/avatar
 *
 * Body: { photo: string }  — base64 JPEG, no data-url prefix
 * Response: { avatarBase64: string }  — base64 image, no data-url prefix
 *
 * Two-stage pipeline — no extra API keys needed:
 *
 * Stage 1 — Vision model via Eazo App AI proxy (mistral.magistral-small-2509):
 *   Analyzes the captured face snapshot → short English appearance description
 *
 * Stage 2 — Pollinations.ai (free, keyless, GET → image bytes):
 *   Builds a vivid cartoon prompt from the description → fetches 512×512 image
 *   → converts to base64 → returns to client
 */

// ── Stage 1: vision model → appearance description ───────────────────────────
async function describeAppearance(photoBase64: string): Promise<string> {
  const platformBase = (process.env.EAZO_APP_AI_API_BASE || "https://eazo.ai").replace(/\/+$/, "");
  const appId        = process.env.EAZO_APP_ID;
  const privateKey   = process.env.EAZO_PRIVATE_KEY;

  // Pick vision model from EAZO_AI_MODELS_JSON
  let visionModel = "mistral.magistral-small-2509";
  try {
    const modelMap = JSON.parse(process.env.EAZO_AI_MODELS_JSON || "{}") as Record<string, string>;
    if (modelMap.vision) visionModel = modelMap.vision;
  } catch { /* use default */ }

  if (!appId || !privateKey) {
    return "young adult with a friendly face and bright eyes";
  }

  const dataUrl = `data:image/jpeg;base64,${photoBase64}`;

  const res = await fetch(`${platformBase}/api/app-ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-eazo-app-id": appId,
      Authorization: `Bearer ${privateKey}`,
    },
    body: JSON.stringify({
      app_id:    appId,
      model_key: visionModel,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Look at the person in this photo and describe their physical appearance",
                "in ONE concise English sentence (max 30 words).",
                "Include: approximate age range, hair color and style, skin tone, notable facial features.",
                "Focus only on appearance — not emotion, background, or clothing.",
                "Reply with ONLY the description sentence, no extra text.",
              ].join(" "),
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      stream: false,
      params: { max_tokens: 80, temperature: 0.3 },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    console.warn("[avatar] vision model failed:", res.status, await res.text().catch(() => ""));
    return "person with a warm, expressive face and bright eyes";
  }

  type ChatResp = { choices?: Array<{ message?: { content?: string } }> };
  const json = (await res.json()) as ChatResp;
  const desc = json?.choices?.[0]?.message?.content?.trim() || "";
  console.log("[avatar] appearance desc:", desc);
  return desc || "person with a friendly smile and expressive eyes";
}

// ── Stage 2: Pollinations.ai text → image ─────────────────────────────────────
async function generateCartoonImage(appearanceDesc: string): Promise<string> {
  const cartoonPrompt = [
    appearanceDesc,
    "transformed into a vibrant cartoon character full of vitality and positive energy",
    "colorful flat-design illustration, clean bold outlines, cel-shading",
    "glowing neon aura, deep space blue-purple background with energy particles",
    "radiant hero portrait from a sci-fi wellness game",
    "upper body centered, square composition, highly detailed",
  ].join(", ");

  const seed    = Date.now() % 99991;
  const encoded = encodeURIComponent(cartoonPrompt);
  const url     = `https://image.pollinations.ai/prompt/${encoded}?model=flux&width=512&height=512&nologo=true&seed=${seed}`;

  console.log("[avatar] Pollinations request:", url.slice(0, 120) + "...");

  const res = await fetch(url, {
    headers: { Accept: "image/jpeg, image/png, image/*" },
    cache:   "no-store",
  });

  if (!res.ok) {
    throw new Error(`Pollinations.ai ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf).toString("base64");
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let body: { photo?: string };
  try {
    body = (await request.json()) as { photo?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { photo } = body;
  if (!photo || typeof photo !== "string") {
    return NextResponse.json({ error: "Missing photo" }, { status: 400 });
  }

  try {
    const appearanceDesc = await describeAppearance(photo);
    const avatarBase64   = await generateCartoonImage(appearanceDesc);
    return NextResponse.json({ avatarBase64 });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[avatar] pipeline error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
