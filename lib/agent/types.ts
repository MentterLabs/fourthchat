import { LanguageModelUsage } from "ai"

export interface AgentConfig {
    chatbotId: string
    userId: string
    settings: {
        model?: string
        systemPrompt?: string
        businessAbout?: string
        fallbackMessage?: string
        temperature?: number
    }
    knowledgeBaseIds: string[]
}

export interface AgentMessage {
    role: "user" | "assistant" | "system"
    content: string
}

export interface AgentContext {
    history: AgentMessage[]
    ragContext?: string
}

export interface AgentResponse {
    text: string;
    usage?: LanguageModelUsage;
    stream?: AsyncIterable<string>;
}
