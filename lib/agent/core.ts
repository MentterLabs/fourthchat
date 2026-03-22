import { AgentConfig, AgentContext, AgentResponse } from "./types"
import { getRelevantContext } from "@/lib/rag-utils"
import { createModelInstance } from "@/lib/ai-helper"
import { generateText, streamText } from "ai"
import { db } from "@/lib/db"
import { messages } from "@/lib/schema"
import { eq } from "drizzle-orm"

export class ChatbotAgent {
    constructor(private config: AgentConfig) { }

    public async process(message: string, conversationId: string): Promise<AgentResponse> {
        const context = await this.buildContext(message, conversationId)
        return this.generateResponse(message, context)
    }

    public async stream(message: string, conversationId: string): Promise<AgentResponse> {
        const context = await this.buildContext(message, conversationId)
        return this.generateStreamResponse(message, context)
    }

    private async buildContext(message: string, conversationId: string): Promise<AgentContext> {
        const history = await db.query.messages.findMany({
            where: eq(messages.conversationId, conversationId),
            orderBy: (messages, { desc }) => [desc(messages.createdAt)],
            limit: 20
        }).then(msgs => msgs.reverse().map(m => ({
            role: m.role as "user" | "assistant",
            content: m.content
        })))

        let ragContext = ""
        if (this.config.knowledgeBaseIds.length > 0) {
            ragContext = await getRelevantContext(message, this.config.knowledgeBaseIds, this.config.userId) || ""
        }

        return {
            history,
            ragContext
        }
    }

    private async generateResponse(message: string, context: AgentContext): Promise<AgentResponse> {
        const { systemPrompt, model } = await this.preparePromptAndModel(context)

        const { text, usage } = await generateText({
            model,
            system: systemPrompt,
            messages: [
                ...context.history,
                { role: "user", content: message }
            ]
        })

        return {
            text,
            usage
        }
    }

    private async generateStreamResponse(message: string, context: AgentContext): Promise<AgentResponse> {
        const { systemPrompt, model } = await this.preparePromptAndModel(context)

        const { textStream, text } = await streamText({
            model,
            system: systemPrompt,
            messages: [
                ...context.history,
                { role: "user", content: message }
            ]
        })

        return {
            text: await text,
            stream: textStream
        }
    }

    private async preparePromptAndModel(context: AgentContext) {
        let systemPrompt = this.config.settings.systemPrompt || ""

        if (context.ragContext) {
            systemPrompt += `\n\nRELEVANT CONTEXT:\n${context.ragContext}`
        }

        if (this.config.settings.businessAbout) {
            systemPrompt += `\n\nCONTEXT & BUSINESS INFO:\n${this.config.settings.businessAbout}`
        }

        if (this.config.settings.fallbackMessage) {
            systemPrompt += `\n\nFALLBACK INSTRUCTION:\nIf you are unsure, say: "${this.config.settings.fallbackMessage}"`
        }

        if (!systemPrompt.trim()) {
            systemPrompt = "You are a helpful AI assistant."
        }

        const modelName = this.config.settings.model || "gpt-4-turbo"
        const model = await createModelInstance(modelName, this.config.userId)

        return { systemPrompt, model }
    }
}
