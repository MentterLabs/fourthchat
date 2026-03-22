import { bot } from "@/lib/chat";
import { db } from "@/lib/db";
import { connections } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    if (mode !== "subscribe" || !token) {
        return NextResponse.json({ error: "Invalid verification request" }, { status: 400 });
    }

    const allConnections = await db.query.connections.findMany({
        where: and(
            eq(connections.type, "whatsapp-business"),
            eq(connections.isActive, true)
        )
    });

    const connection = allConnections.find(c => {
        const cfg = c.config as Record<string, string>;
        return cfg?.verifyToken === token;
    });

    if (connection) {
        return new Response(challenge, { status: 200 });
    }

    return NextResponse.json({ error: "Forbidden - token mismatch" }, { status: 403 });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;

        if (value?.messages?.[0]) {
            const metadata = value.metadata;
            const phoneNumberId = metadata?.phone_number_id;

            const allConnections = await db.query.connections.findMany({
                where: and(
                    eq(connections.type, "whatsapp-business"),
                    eq(connections.isActive, true)
                )
            });

            const connection = allConnections.find(c => {
                const cfg = c.config as Record<string, string>;
                return cfg?.phoneNumberId === phoneNumberId;
            });

            if (!connection) {
                console.error(`No WhatsApp connection found for phoneNumberId: ${phoneNumberId}`);
                return NextResponse.json({ error: "No matching connection found" }, { status: 404 });
            }

            const config = connection.config as Record<string, string>;

            const dynamicAdapter = createWhatsAppAdapter({
                phoneNumberId: config.phoneNumberId || "",
                accessToken: config.accessToken || "",
                verifyToken: config.verifyToken || "",
                appSecret: config.appSecret || ""
            });

            await bot.initialize();
            await dynamicAdapter.initialize(bot);

            const clonedReq = new NextRequest(req.url, {
                method: req.method,
                headers: req.headers,
                body: JSON.stringify(body)
            });

            return dynamicAdapter.handleWebhook(clonedReq);
        }

        return NextResponse.json({ status: "received" });

    } catch (error) {
        console.error("WhatsApp webhook error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
