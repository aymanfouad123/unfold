import OpenAI from "openai";
import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are a gentle journaling companion. Given the writer's current draft, ask exactly one short, light clarifying question that helps them flesh out their idea. Do not lecture, summarize, or ask multiple questions. Reply with only the question.`;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text =
    typeof body === "object" &&
    body !== null &&
    "text" in body &&
    typeof (body as { text: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : "";

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
