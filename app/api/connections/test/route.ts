import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { connections } from "@/lib/schema"
import { eq, and } from "drizzle-orm"
import { createHmac } from "crypto"
import type { WebhookConfig } from "@/lib/types"

export async function POST(req: Request) {
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

        // Get connection
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

        if (connection.type !== "webhook") {
            return NextResponse.json(
                { error: "Connection is not a webhook type" },
                { status: 400 }
            )
        }

        const config = connection.config as WebhookConfig | null
        const webhookUrl = config?.webhookUrl
        const secret = config?.secret

        if (!webhookUrl) {
            return NextResponse.json(
                { error: "Webhook URL not configured" },
                { status: 400 }
            )
        }

        // Create test payload
        const testPayload = {
            test: true,
            message: "This is a test webhook from your chatbot!",
            timestamp: new Date().toISOString(),
            connectionId: connection.id,
            connectionName: connection.name
        }

        // Generate signature
        const signature = secret
            ? createHmac("sha256", secret)
                .update(JSON.stringify(testPayload))
                .digest("hex")
            : ""

        // Send test webhook
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Webhook-Signature": signature,
                "X-Webhook-Timestamp": new Date().toISOString(),
                "User-Agent": "Chatbot-Webhook-Test/1.0",
                ...(config?.headers || {})
            },
            body: JSON.stringify(testPayload),
            signal: AbortSignal.timeout(10000) // 10s timeout for test
        })

        const responseText = await response.text()

        return NextResponse.json({
            success: response.ok,
            status: response.status,
            statusText: response.statusText,
            response: responseText.substring(0, 500), // Limit response size
            headers: Object.fromEntries(response.headers.entries())
        })

    } catch (error: unknown) {
        console.error("Error testing webhook:", error)

        // Provide more specific error messages
        let errorMessage = "Unknown error"
        let errorDetails = ""

        if (error instanceof Error) {
            errorMessage = error.message

            // Check for common connection errors
            if (error.cause && typeof error.cause === 'object' && 'code' in error.cause) {
                const code = (error.cause as { code: string }).code
                switch (code) {
                    case 'ECONNREFUSED':
                        errorMessage = "Connection refused"
                        errorDetails = "The webhook URL is not reachable. Make sure the target server is running and the URL is correct. If testing locally, use a tool like ngrok to expose your local server."
                        break
                    case 'ENOTFOUND':
                        errorMessage = "Host not found"
                        errorDetails = "The webhook URL domain could not be resolved. Check that the URL is correct."
                        break
                    case 'ETIMEDOUT':
                        errorMessage = "Connection timed out"
                        errorDetails = "The target server took too long to respond."
                        break
                }
            }

            // Check for abort/timeout errors
            if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                errorMessage = "Request timed out"
                errorDetails = "The webhook request took longer than 10 seconds to respond."
            }
        }

        return NextResponse.json(
            {
                success: false,
                error: errorMessage,
                details: errorDetails || undefined,
                message: error instanceof Error ? error.message : "Unknown error"
            },
            { status: 500 }
        )
    }
}
