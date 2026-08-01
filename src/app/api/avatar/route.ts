import { type NextRequest, NextResponse } from "next/server";

/**
 * POST /api/avatar
 *
 * Body: { photo: string }   — base64 JPEG, no data-url prefix
 * Response: { avatarBase64: string } — base64 PNG, no data-url prefix
 *
 * Calls OpenAI gpt-image-1 (image edit endpoint) with the user's face photo
 * and a vivid cartoon/illustration prompt. Returns the generated image as base64.
 *
 * Requires env vars:
 *   IMAGE_GEN_API_KEY   — OpenAI API key (sk-...)
 *   IMAGE_GEN_BASE_URL  — optional override (defaults to https://api.openai.com/v1)
 *   IMAGE_GEN_MODEL     — optional override (defaults to gpt-image-1)
 */
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

  const apiKey  = process.env.IMAGE_GEN_API_KEY || "";
  const baseUrl = (process.env.IMAGE_GEN_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model   = process.env.IMAGE_GEN_MODEL   || "gpt-image-1";

  if (!apiKey) {
    return NextResponse.json({ error: "IMAGE_GEN_API_KEY not configured" }, { status: 503 });
  }

  // ── Build multipart/form-data for the image edit endpoint ─────────────────
  // We use the edits endpoint so we can pass the real face as a reference
  const prompt = [
    "Transform this person into a vibrant, expressive cartoon character full of vitality and energy.",
    "Style: colorful flat-design illustration with clean outlines, cel-shading, and a glowing aura.",
    "Keep the person's facial features, hair color, and approximate age — just make it cartoon stylized.",
    "Background: abstract deep-space blue-purple (#07071a) with neon energy particles and soft radial glow.",
    "The character should look alive, strong, and radiant — like a hero card from a sci-fi wellness game.",
    "Square 1:1 composition, face and upper body centered. No text. No watermarks.",
  ].join(" ");

  // Convert base64 → Blob for multipart upload
  const imageBytes = Buffer.from(photo, "base64");
  const imageBlob  = new Blob([imageBytes], { type: "image/jpeg" });

  // Create a 1024×1024 all-opaque mask (gpt-image-1 requires a mask for edits)
  // We want to re-style the whole image, so the mask is entirely white (edit everywhere)
  const maskBytes = createWhiteMaskPng(1024, 1024);
  const maskBlob  = new Blob([maskBytes], { type: "image/png" });

  const form = new FormData();
  form.append("model",  model);
  form.append("prompt", prompt);
  form.append("image",  imageBlob, "face.jpg");
  form.append("mask",   maskBlob,  "mask.png");
  form.append("n",      "1");
  form.append("size",   "1024x1024");
  form.append("response_format", "b64_json");

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    console.error("[avatar] fetch error:", (err as Error).message);
    return NextResponse.json({ error: "Network error reaching image API" }, { status: 502 });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    console.error(`[avatar] upstream ${upstream.status}:`, text.slice(0, 300));
    return NextResponse.json(
      { error: `Image API ${upstream.status}` },
      { status: upstream.status >= 500 ? 502 : upstream.status }
    );
  }

  type ImageResponse = { data: Array<{ b64_json?: string; url?: string }> };
  const json = (await upstream.json()) as ImageResponse;
  const b64  = json?.data?.[0]?.b64_json;

  if (!b64) {
    console.error("[avatar] no b64_json in response:", JSON.stringify(json).slice(0, 200));
    return NextResponse.json({ error: "No image returned" }, { status: 502 });
  }

  return NextResponse.json({ avatarBase64: b64 });
}

// ── Minimal valid white-fill PNG (1×1 scaled to logical size via IHDR) ────────
// gpt-image-1 mask: white = edit this area. We generate a real 1024×1024
// white PNG using raw bytes so we don't need the `canvas` npm package server-side.
function createWhiteMaskPng(width: number, height: number): Uint8Array {
  // We'll produce a minimal but valid grayscale PNG with all-255 pixels.
  // Format: PNG sig + IHDR + IDAT (deflate of raw scanlines) + IEND
  const crc32 = makeCrc32();

  function chunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type);
    const len = data.length;
    const buf = new Uint8Array(12 + len);
    const dv  = new DataView(buf.buffer);
    dv.setUint32(0, len);
    buf.set(typeBytes, 4);
    buf.set(data, 8);
    const crcBuf = new Uint8Array(4 + len);
    crcBuf.set(typeBytes, 0);
    crcBuf.set(data, 4);
    dv.setUint32(8 + len, crc32(crcBuf) >>> 0);
    return buf;
  }

  // IHDR: width, height, bit depth 8, color type 0 (grayscale), compress 0, filter 0, interlace 0
  const ihdrData = new Uint8Array(13);
  const ihdrDV   = new DataView(ihdrData.buffer);
  ihdrDV.setUint32(0, width);
  ihdrDV.setUint32(4, height);
  ihdrData[8]  = 8;  // bit depth
  ihdrData[9]  = 0;  // grayscale
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  // Raw image data: each row is filter byte (0) + width bytes of 0xFF
  const raw = new Uint8Array(height * (1 + width));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width)] = 0; // filter type None
    raw.fill(0xFF, y * (1 + width) + 1, y * (1 + width) + 1 + width);
  }

  // Deflate with zlib (RFC 1950 wrapper around deflate stored blocks)
  const idat = zlibDeflate(raw);

  const sig   = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr  = chunk("IHDR", ihdrData);
  const idatC = chunk("IDAT", idat);
  const iend  = chunk("IEND", new Uint8Array(0));

  const total = sig.length + ihdr.length + idatC.length + iend.length;
  const out   = new Uint8Array(total);
  let off = 0;
  for (const part of [sig, ihdr, idatC, iend]) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

function makeCrc32() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return function crc(data: Uint8Array): number {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
}

// Minimal zlib deflate — stored (non-compressed) blocks, valid for any size
function zlibDeflate(data: Uint8Array): Uint8Array {
  const BLOCK = 65535;
  const numBlocks = Math.ceil(data.length / BLOCK) || 1;
  // zlib header (CM=8, CINFO=7 → 0x78, FLEVEL=0, FCHECK=156 → 0x9C)
  const out = new Uint8Array(2 + numBlocks * 5 + data.length + 4);
  const dv  = new DataView(out.buffer);
  out[0] = 0x78; out[1] = 0x9C;
  let pos = 2, src = 0;
  for (let b = 0; b < numBlocks; b++) {
    const blen   = Math.min(BLOCK, data.length - src);
    const isLast = b === numBlocks - 1 ? 1 : 0;
    out[pos++] = isLast;
    out[pos++] = blen & 0xFF;
    out[pos++] = (blen >> 8) & 0xFF;
    out[pos++] = (~blen) & 0xFF;
    out[pos++] = ((~blen) >> 8) & 0xFF;
    out.set(data.subarray(src, src + blen), pos);
    pos += blen; src += blen;
  }
  // Adler-32
  let s1 = 1, s2 = 0;
  for (let i = 0; i < data.length; i++) { s1 = (s1 + data[i]) % 65521; s2 = (s2 + s1) % 65521; }
  dv.setUint32(pos, ((s2 << 16) | s1) >>> 0);
  return out;
}
