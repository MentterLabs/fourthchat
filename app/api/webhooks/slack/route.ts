import { bot } from "@/lib/chat";
import { db } from "@/lib/db";
import { connections } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { createSlackAdapter } from "@chat-adapter/slack";
import { SlackConfig } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get("connectionId");

  if (!connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }

  const connection = await db.query.connections.findFirst({
    where: eq(connections.id, connectionId),
  });

  if (!connection || connection.type !== "slack") {
    return NextResponse.json({ error: "Slack connection not found" }, { status: 404 });
  }

  const config = {
    type: connection.type,
    ...(connection.config as Record<string, unknown>)
  } as SlackConfig;

  if (config.type !== "slack") {
    return NextResponse.json({ error: "Invalid connection type" }, { status: 400 });
  }

  const body = await request.clone().json().catch(() => ({}));
  if (body.type === "url_verification" && body.challenge) {
    return new Response(body.challenge, { status: 200 });
  }

  const dynamicAdapter = createSlackAdapter({
    signingSecret: config.signingSecret,
    botToken: config.botToken,
  });

  await bot.initialize();

  await dynamicAdapter.initialize(bot);

  const botUserId = dynamicAdapter.botUserId;
  const currentConfig = connection.config as Record<string, unknown>;

  if (botUserId && currentConfig.botUserId !== botUserId) {
    await db.update(connections)
      .set({
        config: {
          ...currentConfig,
          botUserId
        }
      })
      .where(eq(connections.id, connectionId));
  }

  return dynamicAdapter.handleWebhook(request);
}

export async function GET() {
  return new Response("Slack Webhook Active", { status: 200 });
}
