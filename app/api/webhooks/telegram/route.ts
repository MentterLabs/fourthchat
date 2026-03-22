import { db } from "@/lib/db";
import { bot } from "@/lib/chat";
import { eq, and } from "drizzle-orm";
import { connections } from "@/lib/schema";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get("connectionId");

  if (!connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }

  const connection = await db.query.connections.findFirst({
    where: and(
      eq(connections.id, connectionId),
      eq(connections.isActive, true)
    ),
  });

  if (!connection || connection.type !== "telegram") {
    return NextResponse.json({ error: "Telegram connection not found" }, { status: 404 });
  }

  const config = connection.config as Record<string, unknown>;

  const dynamicAdapter = createTelegramAdapter({
    botToken: config.botToken as string,
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
  return new Response("Telegram Webhook Active", { status: 200 });
}
