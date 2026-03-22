import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { EmbeddingModel } from "ai"

export type EmbeddingProvider = "openai" | "gemini"

export const EMBEDDING_DIMENSIONS: Record<EmbeddingProvider, number> = {
    openai: 1536,
    gemini: 3072,
}

export function createEmbeddingModel(provider: string, apiKey: string, modelId?: string): EmbeddingModel<string> {
    switch (provider) {
        case "openai":
            const openai = createOpenAI({ apiKey })
            return openai.embedding(modelId || "text-embedding-3-small")
        case "gemini":
            const google = createGoogleGenerativeAI({ apiKey })
            const actualModelId = modelId === "text-embedding-004" ? "gemini-embedding-001" : (modelId || "gemini-embedding-001")
            return google.textEmbeddingModel(actualModelId)
        default:
            throw new Error(`Unsupported embedding provider: ${provider}`)
    }
}

export function getVectorDimension(provider: string): number {
    return EMBEDDING_DIMENSIONS[provider as EmbeddingProvider] || 768
}
