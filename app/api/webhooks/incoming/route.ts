import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { connections, conversations, messages, webhookDeliveries, chatbots, chatbotKnowledgeBases } from "@/lib/schema"
import { eq, and } from "drizzle-orm"
import { verifyApiKey } from "@/lib/api-key-utils"
import { apiKeys } from "@/lib/schema"
import { streamText } from "ai"
import { openai } from "@ai-sdk/openai"
import { google } from "@ai-sdk/google"
import { getRelevantContext } from "@/lib/rag-utils"
import { sendWebhook } from "@/lib/webhook-sender"
import type { WebhookConfig } from "@/lib/types"

// Force rebuild
export const runtime = "nodejs"

interface IncomingWebhookRequest {
    connectionId: string
    userId: string
    message: string
    metadata?: Record<string, unknown>
}

export async function POST(req: Request) {
    try {
        // 1. Validate API Key
        const authHeader = req.headers.get("authorization")
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json(
                { error: "Missing or invalid Authorization header" },
                { status: 401 }
            )
        }

        const providedKey = authHeader.replace("Bearer ", "")

        // Find and verify API key
        const allKeys = await db.query.apiKeys.findMany({
            where: eq(apiKeys.isActive, true)
        })

        let matchedKey = null
        for (const keyRecord of allKeys) {
            if (verifyApiKey(providedKey, keyRecord.key)) {
                matchedKey = keyRecord
                break
            }
        }

        if (!matchedKey) {
            return NextResponse.json(
                { error: "Invalid API key" },
                { status: 401 }
            )
        }

        // 2. Parse request body
        const body: IncomingWebhookRequest = await req.json()
        const { connectionId, userId, message, metadata } = body

        if (!connectionId || !userId || !message) {
            return NextResponse.json(
                { error: "connectionId, userId, and message are required" },
                { status: 400 }
            )
        }

        // 3. Get and validate connection
        const connection = await db.query.connections.findFirst({
            where: and(
                eq(connections.id, connectionId),
                eq(connections.userId, matchedKey.userId),
                eq(connections.isActive, true)
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

        const chatbotId = connection.chatbotId

        // 4. Get or create conversation for this external user
        let conversation = await db.query.conversations.findFirst({
            where: and(
                eq(conversations.chatbotId, chatbotId!),
                eq(conversations.externalUserId, userId)
            )
        })

        if (!conversation) {
            const [newConv] = await db.insert(conversations).values({
                chatbotId: chatbotId!,
                externalUserId: userId,
            }).returning()
            conversation = newConv
        }

        // 5. Save user message
        const [userMessage] = await db.insert(messages).values({
            conversationId: conversation.id,
            role: "user",
            content: message,
        }).returning()

        // 6. Get chatbot and settings
        const chatbot = await db.query.chatbots.findFirst({
            where: eq(chatbots.id, chatbotId!),
            with: {
                settings: true
            }
        })

        if (!chatbot) {
            return NextResponse.json(
                { error: "Chatbot not found" },
                { status: 404 }
            )
        }

        const settings = chatbot.settings

        // 7. Get conversation history
        const conversationHistory = await db.query.messages.findMany({
            where: eq(messages.conversationId, conversation.id),
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
            limit: 20
        })

        const chatMessages = conversationHistory.map(m => ({
            role: m.role as "user" | "assistant",
            content: m.content
        }))

        // 8. Get RAG context if needed
        let context = ""
        const linkedKbs = await db.query.chatbotKnowledgeBases.findMany({
            where: eq(chatbotKnowledgeBases.chatbotId, chatbotId!)
        })

        if (linkedKbs.length > 0) {
            const kbIds = linkedKbs.map(kb => kb.knowledgeBaseId)
            context = await getRelevantContext(message, kbIds, connection.userId)
        }

        // 9. Build system prompt
        let systemPrompt = settings?.systemPrompt || "You are a helpful AI assistant."

        if (context) {
            systemPrompt += `\n\nKNOWLEDGE BASE CONTEXT:\n${context}\n\nINSTRUCTIONS:\nAnswer the user's question based ONLY on the above context. If the answer is not in the context, say you don't know.`
        }

        if (settings?.businessAbout) {
            systemPrompt += `\n\nCONTEXT & BUSINESS INFO:\n${settings.businessAbout}`
        }

        if (settings?.fallbackMessage) {
            systemPrompt += `\n\nFALLBACK INSTRUCTION:\nIf you are unsure or don't have the answer, strictly say: "${settings.fallbackMessage}"`
        }

        const toneInstructions = []
        if (settings?.tone && settings.tone !== 'neutral') toneInstructions.push(`Tone: ${settings.tone}`)
        if (settings?.responseLength) {
            if (settings.responseLength === 'short') toneInstructions.push("Keep responses concise and short.")
            else if (settings.responseLength === 'descriptive') toneInstructions.push("Provide detailed and descriptive responses.")
        }
        if (settings?.languages && Array.isArray(settings.languages) && settings.languages.length > 0) {
            toneInstructions.push(`Respond in one of these languages: ${settings.languages.join(', ')}`)
        }
        if (settings?.gender && settings.gender !== 'neutral') toneInstructions.push(`Persona gender: ${settings.gender}`)

        if (toneInstructions.length > 0) {
            systemPrompt += `\n\nSTYLE GUIDELINES:\n${toneInstructions.join('\n')}`
        }

        const formatting = []
        if (settings?.useEmojis) formatting.push("Use emojis where appropriate to be friendly.")
        if (settings?.useBulletPoints) formatting.push("Use bullet points for lists or structured info.")

        if (formatting.length > 0) {
            systemPrompt += `\n\nFORMATTING:\n${formatting.join('\n')}`
        }

        if (settings?.avoidWords) {
            systemPrompt += `\n\nAVOIDANCE:\nDo not use these words/phrases: ${settings.avoidWords}`
        }

        if (settings?.dos && Array.isArray(settings.dos) && settings.dos.length > 0) {
            systemPrompt += `\n\nDO:\n- ${settings.dos.join('\n- ')}`
        }
        if (settings?.donts && Array.isArray(settings.donts) && settings.donts.length > 0) {
            systemPrompt += `\n\nDON'T:\n- ${settings.donts.join('\n- ')}`
        }

        // 10. Get AI response
        const modelName = settings?.model || "gpt-3.5-turbo"
        const model = modelName.startsWith("gemini")
            ? google(modelName)
            : openai(modelName)

        const result = streamText({
            model,
            system: systemPrompt,
            messages: chatMessages,
        })

        // Collect full response text
        let responseText = ""
        for await (const chunk of result.textStream) {
            responseText += chunk
        }

        // 11. Save assistant message
        const [assistantMessage] = await db.insert(messages).values({
            conversationId: conversation.id,
            role: "assistant",
            content: responseText,
        }).returning()

        // 12. Queue webhook delivery
        const webhookConfig = {
            type: connection.type,
            ...(connection.config as Record<string, unknown>)
        } as WebhookConfig

        const webhookUrl = webhookConfig.type === "webhook" ? webhookConfig.webhookUrl : undefined
        const secret = webhookConfig.type === "webhook" ? webhookConfig.secret : undefined

        if (webhookUrl) {
            const payload = {
                userId,
                message: responseText,
                conversationId: conversation.id,
                messageId: assistantMessage.id,
                timestamp: new Date().toISOString(),
                metadata
            }

            // Create delivery record
            const [delivery] = await db.insert(webhookDeliveries).values({
                connectionId: connection.id,
                messageId: assistantMessage.id,
                webhookUrl,
                payload,
                status: "pending",
            }).returning()

            sendWebhook({
                deliveryId: delivery.id,
                webhookUrl,
                secret: secret || "",
                payload,
                headers: (webhookConfig.headers as Record<string, string> | undefined) || {}
            }).catch(console.error)
        }

        // 13. Update connection stats
        await db.update(connections)
            .set({
                totalMessages: (connection.totalMessages || 0) + 1,
                lastUsedAt: new Date()
            })
            .where(eq(connections.id, connection.id))

        return NextResponse.json({
            success: true,
            messageId: userMessage.id,
            conversationId: conversation.id,
            response: responseText
        })

    } catch (error) {
        console.error("Webhook incoming error:", error)
        return NextResponse.json(
            { error: "Internal server error", message: error instanceof Error ? error.message : "Unknown error" },
            { status: 500 }
        )
    }
}
