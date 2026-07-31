import { type NextRequest, NextResponse } from "next/server";
import { appAi } from "@/lib/eazo-ai-billing";

/**
 * POST /api/report/interpret
 *
 * Body: { metrics: Metrics8, mood: string, locale: "zh-CN" | "en-US" }
 * Response: text/plain SSE stream — plain text chunks (no SSE envelope)
 *
 * No auth required: the data is purely client-computed physiological estimates
 * with no user-identifiable information attached.
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

  // ── Build metrics summary for the prompt ──────────────────────────────────
  const fmt = (v: number | null, unit: string) =>
    v !== null ? `${v}${unit}` : "暂无数据";

  const metricsSummary =
    locale === "zh-CN"
      ? `
心率: ${fmt(metrics.hr, " BPM")}
呼吸率: ${fmt(metrics.rr, " 次/分")}
血氧SpO₂: ${fmt(metrics.spo2, "%")}（实验性）
心率变异RMSSD: ${fmt(metrics.rmssd, " ms")}
LF/HF自律神经比值: ${fmt(metrics.lfhf, "")}
Baevsky压力指数: ${fmt(metrics.si, "")}
疲劳指数FI: ${fmt(metrics.fi, "/100")}（启发式）
认知负荷MWI: ${fmt(metrics.mwi, "/100")}（启发式）
`.trim()
      : `
Heart Rate: ${fmt(metrics.hr, " BPM")}
Resp Rate: ${fmt(metrics.rr, " /min")}
SpO₂: ${fmt(metrics.spo2, "%")} (experimental)
HRV RMSSD: ${fmt(metrics.rmssd, " ms")}
LF/HF Ratio: ${fmt(metrics.lfhf, "")}
Stress Index SI: ${fmt(metrics.si, "")}
Fatigue FI: ${fmt(metrics.fi, "/100")} (heuristic)
Cognitive Load MWI: ${fmt(metrics.mwi, "/100")} (heuristic)
`.trim();

  // ── Construct prompt ───────────────────────────────────────────────────────
  const systemPrompt =
    locale === "zh-CN"
      ? `你是一个超懂身体语言的 AI 健康搭档，有点俏皮、有点温暖，像朋友一样说话。
你的任务：根据用户当下的生理指标 + 心情描述，生成一段200字以内、轻松有趣又有正能量的健康 Tips。
风格要求：
- 像在跟朋友聊天，不用严肃，可以用 emoji，但不要滥用
- 聚焦3-4个有意思的发现（不要每个指标都提，挑有意思的说）
- 给1-2个具体、可操作的小建议（具体到"现在可以做什么"）
- 结尾可以有鼓励的话，但别太鸡汤
- 绝对不做医疗诊断，不说"建议就医"之类的话
- 不超过200字`
      : `You are a witty, warm AI health companion — like a knowledgeable friend who keeps it real.
Your task: Given the user's biometric readings and mood, write a fun, uplifting health tips message under 200 words.
Style rules:
- Conversational, not clinical. Use emojis sparingly but effectively
- Highlight 3-4 interesting observations (don't recite every metric — pick the telling ones)
- Give 1-2 specific, actionable micro-suggestions ("right now you could...")
- End with a light, genuine encouragement (not cheesy)
- Never diagnose or suggest seeing a doctor
- Under 200 words`;

  const userPrompt =
    locale === "zh-CN"
      ? `我的生理指标：\n${metricsSummary}\n\n我现在的心情：${mood || "没有特别描述"}\n\n请给我今天的健康 Tips！`
      : `My biometrics:\n${metricsSummary}\n\nHow I'm feeling: ${mood || "not specified"}\n\nGive me my health tips!`;

  // ── Stream LLM response ───────────────────────────────────────────────────
  try {
    const stream = await appAi.chat({
      model: process.env.AI_PROVIDER_MODEL || "mimo-v2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      stream: true,
      max_tokens: 400,
      temperature: 0.85,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream as AsyncIterable<{ choices: Array<{ delta?: { content?: string } }> }>) {
            const delta = chunk.choices[0]?.delta?.content ?? "";
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        } catch (err) {
          console.error("[interpret] stream error:", err);
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
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = (err as Error).message ?? "AI unavailable";
    console.error("[interpret] top-level error:", msg);
    // Return error as a plain-text stream so the client ReadableStream reader
    // doesn't hang — wrap in 200 so the browser body reader can consume it,
    // but prefix with a sentinel the client can detect.
    const encoder = new TextEncoder();
    const errStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`__ERROR__: ${msg}`));
        controller.close();
      },
    });
    return new Response(errStream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
