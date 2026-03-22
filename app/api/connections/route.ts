import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { connections, chatbots } from "@/lib/schema"
import { eq, and, desc } from "drizzle-orm"
import { randomBytes } from "crypto"
import type { ConnectionConfig, WebhookConfig } from "@/lib/types"
import { deleteDrizzleAuthState } from "@/lib/whatsapp/auth"

export async function GET(req: Request) {
    const session = await auth()
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
        const { searchParams } = new URL(req.url)
        const chatbotId = searchParams.get("chatbotId")

        if (!chatbotId) {
            return NextResponse.json({ error: "chatbotId is required" }, { status: 400 })
        }

        const chatbot = await db.query.chatbots.findFirst({
            where: eq(chatbots.id, chatbotId)
        })

        if (!chatbot) {
            return NextResponse.json({ error: "Chatbot not found" }, { status: 404 })
        }

        // Verify ownership
        if (chatbot.userId !== session.user.id) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 })
        }

        const allConnections = await db.query.connections.findMany({
            where: eq(connections.chatbotId, chatbotId),
            orderBy: [desc(connections.createdAt)],
            with: {
                chatbot: true
            }
        })

        const sanitizedConnections = allConnections.map(conn => {
            const config = {
                type: conn.type,
                ...(conn.config as Record<string, unknown>)
            } as ConnectionConfig

            const isWebhook = config.type === "webhook";

            return {
                ...conn,
                chatbotName: conn.chatbot?.name,
                config: {
                    ...config,
                    secret: (isWebhook && (config as WebhookConfig).secret) ? "••••••••" : undefined
                }
            }
        })

        return NextResponse.json(sanitizedConnections)

    } catch (error) {
        console.error("Error fetching connections:", error)
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        )
    }
}

export async function POST(req: Request) {
    const session = await auth()
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
        const body = await req.json()
        const { type, name, chatbotId, config } = body

        if (!type || !name || !chatbotId) {
            return NextResponse.json(
                { error: "type, name, and chatbotId are required" },
                { status: 400 }
            )
        }

        // Verify user owns this chatbot
        const chatbot = await db.query.chatbots.findFirst({
            where: eq(chatbots.id, chatbotId)
        })

        if (!chatbot) {
            return NextResponse.json({ error: "Chatbot not found" }, { status: 404 })
        }

        if (chatbot.userId !== session.user.id) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 })
        }

        // Validate webhook type
        if (type === "webhook") {
            if (!config?.webhookUrl) {
                return NextResponse.json(
                    { error: "webhookUrl is required for webhook connections" },
                    { status: 400 }
                )
            }

            // Validate URL format
            try {
                new URL(config.webhookUrl)
            } catch {
                return NextResponse.json(
                    { error: "Invalid webhookUrl format" },
                    { status: 400 }
                )
            }

            // Generate secret if not provided
            if (!config.secret) {
                config.secret = randomBytes(32).toString("hex")
            }
        }

        // Create connection
        const [newConnection] = await db.insert(connections).values({
            userId: session.user.id,
            chatbotId,
            type,
            name,
            config: {
                ...config,
                type
            },
            isActive: true
        }).returning()

        if (type === "telegram" && config.botToken) {
            const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
            if (!appUrl) {
                return NextResponse.json({ 
                    error: "APP_URL is not configured. Webhook registration skipped.",
                    connection: newConnection 
                }, { status: 400 });
            }

            const webhookUrl = `${appUrl}/api/webhooks/telegram?connectionId=${newConnection.id}`;
            const telegramApiUrl = `https://api.telegram.org/bot${config.botToken}/setWebhook?url=${webhookUrl}`;

            try {
                const response = await fetch(telegramApiUrl);
                const result = await response.json();

                if (!response.ok || !result.ok) {
                    return NextResponse.json({ 
                        error: `Failed to register Telegram webhook: ${result.description || "Unknown error"}`,
                        connection: newConnection 
                    }, { status: 400 });
                }
            } catch (err) {
                console.error("[Telegram Registration] Error setting webhook:", err);
                return NextResponse.json({ 
                    error: "Network error while registering Telegram webhook.",
                    connection: newConnection 
                }, { status: 500 });
            }
        }

        return NextResponse.json(newConnection)

    } catch (error) {
        console.error("Error creating connection:", error)
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        )
    }
}

export async function DELETE(req: Request) {
    const session = await auth()
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
        const { searchParams } = new URL(req.url)
        const id = searchParams.get("id")

        if (!id) {
            return NextResponse.json({ error: "Connection ID is required" }, { status: 400 })
        }

        const connection = await db.query.connections.findFirst({
            where: and(
                eq(connections.id, id),
                eq(connections.userId, session.user.id)
            )
        })

        if (!connection) {
            return NextResponse.json(
                { error: "Connection not found or access denied" },
                { status: 404 }
            )
        }

        if (connection.type === 'whatsapp') {
            await deleteDrizzleAuthState(id)
        }
        await db.delete(connections)
            .where(eq(connections.id, id))

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error("Error deleting connection:", error)
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        )
    }
}
