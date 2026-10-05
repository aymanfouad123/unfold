import OpenAI from "openai";
import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are a gentle journaling companion. Given the writer's current draft, ask exactly one short, light clarifying question that helps them flesh out their idea. Do not lecture, summarize, or ask multiple questions. Reply with only the question.`;

const CHAT_SYSTEM_PROMPT = `You are a warm, gentle journaling companion. Keep replies concise (1–3 short sentences). Reference the writer's draft when it helps. Ask clarifying questions when useful. Do not lecture, summarize their whole entry unprompted, or overwhelm them with advice.`;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: ChatMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return null;
    }
    const trimmed = content.trim();
    if (!trimmed) continue;
    messages.push({ role, content: trimmed });
  }
  return messages.slice(-20);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = body as { text?: unknown; messages?: unknown };
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const hasMessages = "messages" in record;

  if (hasMessages) {
    const messages = parseMessages(record.messages);
    if (messages === null) {
      return NextResponse.json(
        { error: "messages must be an array of { role: 'user' | 'assistant', content: string }" },
        { status: 400 },
      );
    }
    if (!messages.length) {
      return NextResponse.json(
        { error: "messages must include at least one non-empty message" },
        { status: 400 },
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY environment variable" },
        { status: 500 },
      );
    }

    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: CHAT_SYSTEM_PROMPT },
          {
            role: "system",
            content: text
              ? `The writer's current journal draft:\n\n${text}`
              : "The writer has not written anything in their draft yet.",
          },
          ...messages,
        ],
      });

      const reply = completion.choices[0]?.message?.content?.trim() ?? "";
      return NextResponse.json({ reply });
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Unexpected error calling OpenAI";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (!text) {
    return NextResponse.json(
      { error: "Request body must include a non-empty string field: text" },
      { status: 400 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY environment variable" },
      { status: 500 },
    );
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    });

    const prompt = completion.choices[0]?.message?.content?.trim() ?? "";

    return NextResponse.json({ prompt });
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Unexpected error calling OpenAI";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
