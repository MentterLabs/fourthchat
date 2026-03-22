import { db } from "@/lib/db";
import { bot } from "@/lib/chat";
import { eq, and } from "drizzle-orm";
import { connections } from "@/lib/schema";
import { DiscordConfig } from "@/lib/types";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get("connectionId");

  let connection;
  if (connectionId) {
    connection = await db.query.connections.findFirst({
      where: eq(connections.id, connectionId),
    });
  } else {
    try {
      const body = await request.clone().json();
      const applicationId = body.application_id;

      if (applicationId) {
        connection = await db.query.connections.findFirst({
          where: and(
            eq(connections.type, "discord"),
            eq(connections.isActive, true)
          ),
        });

        if (connection) {
          const allDiscord = await db.query.connections.findMany({
            where: and(
              eq(connections.type, "discord"),
              eq(connections.isActive, true)
            )
          });
          connection = allDiscord.find(c => {
            const cfg = c.config as Record<string, unknown>;
            return cfg?.applicationId === applicationId;
          });
        }
      }
    } catch (e) {
      console.error("[Discord Webhook] Failed to parse body for appId lookup", e);
    }
  }

  if (!connection) {
    if (!connectionId && bot.webhooks.discord) {
      return bot.webhooks.discord(request);
    }
    return NextResponse.json({ error: "Discord connection not found" }, { status: 404 });
  }

  const config = {
    type: connection.type,
    ...(connection.config as Record<string, unknown>)
  } as DiscordConfig;

  if (config.type !== "discord") {
    return NextResponse.json({ error: "Invalid connection type" }, { status: 400 });
  }

  const dynamicAdapter = createDiscordAdapter({
    applicationId: config.applicationId,
    botToken: config.botToken,
    publicKey: config.publicKey,
  });

  await bot.initialize();
  await dynamicAdapter.initialize(bot);

  try {
    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");

    if (!signature || !timestamp) {
      console.warn("[Discord Webhook] Missing signature/timestamp headers");
    }

    return await dynamicAdapter.handleWebhook(request);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Internal Error";
    console.error("[Discord Webhook] Error in handleWebhook:", errorMessage);
    return NextResponse.json({ error: "Failed to handle interaction" }, { status: 500 });
  }
}

export async function GET() {
  return new Response("Discord Webhook Active", { status: 200 });
}
