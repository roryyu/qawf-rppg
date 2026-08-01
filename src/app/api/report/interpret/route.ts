import { type NextRequest, NextResponse } from "next/server";

/**
 * POST /api/report/interpret
 *
 * Body: { metrics: Metrics8, mood: string, locale: "zh-CN" | "en-US" }
 * Response: text/plain stream — actual answer tokens only (reasoning tokens skipped)
 *
 * Why bypass appAi: mimo-v2.5-pro is a reasoning model. Its SSE stream emits
 * delta.reasoning_content during the thinking phase and delta.content during
 * the answer phase. The shared appAi helper only collects delta.content; when
 * max_tokens is too low the reasoning phase exhausts the budget and content is
 * empty. This route directly calls the provider and handles both fields.
 */
export async function POST(request: NextRequest) {
  let body: { metrics: Record<string, number | null>; mood: string; locale?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { metrics, mood, locale = "zh-CN" } = body;
  if (!metrics || typeof mood !== "string") {
    return NextResponse.json({ error: "Missing metrics or mood" }, { status: 400 });
  }

  const baseUrl = (process.env.AI_PROVIDER_BASE_URL || "").replace(/\/+$/, "");
  const apiKey  = process.env.AI_PROVIDER_API_KEY || "";
  const model   = process.env.AI_PROVIDER_MODEL   || "mimo-v2.5-pro";

  if (!baseUrl || !apiKey) {
    return NextResponse.json({ error: "AI provider not configured" }, { status: 503 });
  }

  // ── Prompts ───────────────────────────────────────────────────────────────
  const fmt = (v: number | null, unit: string) =>
    v !== null ? `${v}${unit}` : "暂无";

  const metricsSummary =
    locale === "zh-CN"
      ? [
          `心率: ${fmt(metrics.hr, " BPM")}`,
          `呼吸率: ${fmt(metrics.rr, " 次/分")}`,
          `血氧SpO₂: ${fmt(metrics.spo2, "%")}（实验性）`,
          `RMSSD: ${fmt(metrics.rmssd, " ms")}`,
          `LF/HF: ${fmt(metrics.lfhf, "")}`,
          `压力指数SI: ${fmt(metrics.si, "")}`,
          `疲劳指数FI: ${fmt(metrics.fi, "/100")}`,
          `认知负荷MWI: ${fmt(metrics.mwi, "/100")}`,
        ].join("\n")
      : [
          `Heart Rate: ${fmt(metrics.hr, " BPM")}`,
          `Resp Rate: ${fmt(metrics.rr, " /min")}`,
          `SpO₂: ${fmt(metrics.spo2, "%")}`,
          `RMSSD: ${fmt(metrics.rmssd, " ms")}`,
          `LF/HF: ${fmt(metrics.lfhf, "")}`,
          `Stress SI: ${fmt(metrics.si, "")}`,
          `Fatigue FI: ${fmt(metrics.fi, "/100")}`,
          `Cognitive MWI: ${fmt(metrics.mwi, "/100")}`,
        ].join("\n");

  const systemPrompt =
    locale === "zh-CN"
      ? `你是一个超懂身体语言的 AI 健康搭档，有点俏皮、有点温暖，像朋友一样说话。
      这是场有趣实验，用户在测试生理指标的同时，其实也花了一分钟和自己面对面，好好看看了自己
用户是创作者，比如自媒体、程序员、艺术家等等对这个世界贡献那么一点点新东西的人们
根据用户的生理指标和心情，生成一段150字以内轻松有趣且正能量的健康 Tips。
要求：
- 挑2-3个最有意思的发现来说，不要逐一列举所有指标
- 给1-2个具体可操作的当下小建议
- 结尾一句话温暖鼓励，要爱自己，不要鸡汤
- 适当用emoji增加活泼感
- 绝不做医疗诊断，不提"就医"`
      : `You're a witty, warm AI health buddy. Based on biometrics and mood, write fun uplifting health tips under 150 words. Pick 2-3 interesting findings, give 1-2 actionable micro-suggestions, end with genuine encouragement. Use emojis sparingly. No medical diagnoses.`;

  const userPrompt =
    locale === "zh-CN"
      ? `我的指标：\n${metricsSummary}\n\n看自己的心情：${mood || "没特别描述"}\n\n请给我今天的健康 Tips！`
      : `My biometrics:\n${metricsSummary}\n\nFeeling: ${mood || "not specified"}\n\nGive me health tips!`;

  // ── Direct SSE fetch — handles reasoning_content + content separately ─────
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        stream: true,
        // Reasoning models need a generous token budget:
        // thinking phase can consume hundreds of tokens before the answer begins.
        max_tokens: 2000,
        temperature: 0.8,
      }),
      cache: "no-store",
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[interpret] fetch error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!upstreamRes.ok) {
    const text = await upstreamRes.text().catch(() => "");
    console.error(`[interpret] upstream ${upstreamRes.status}:`, text.slice(0, 300));
    return NextResponse.json(
      { error: `Provider ${upstreamRes.status}: ${text.slice(0, 200)}` },
      { status: upstreamRes.status }
    );
  }

  // ── Pipe SSE, forwarding only content tokens (skip reasoning_content) ─────
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const reader  = upstreamRes.body!.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;

            let chunk: {
              choices?: Array<{
                delta?: { content?: string | null; reasoning_content?: string | null };
                finish_reason?: string | null;
              }>;
            };
            try {
              chunk = JSON.parse(data) as typeof chunk;
            } catch {
              continue; // malformed line, skip
            }

            const delta   = chunk.choices?.[0]?.delta;
            // Only forward the answer content, not the thinking/reasoning tokens
            const content = delta?.content;
            if (content) {
              controller.enqueue(encoder.encode(content));
            }
          }
        }
      } catch (err) {
        console.error("[interpret] stream read error:", err);
        controller.enqueue(encoder.encode(`\n[ERROR] ${(err as Error).message}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-store",
    },
  });
}
