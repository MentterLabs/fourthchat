import { db } from "@/lib/db"
import { knowledgeSources, users } from "@/lib/schema"
import { eq } from "drizzle-orm"
import { embedMany } from "ai"
import { qdrant, CHATBOT_COLLECTION, ensureCollection } from "@/lib/qdrant"
import { chunkText } from "@/lib/source-processor"
import { createEmbeddingModel, getVectorDimension } from "@/lib/embedding-config"

interface ProcessingResult {
    success: boolean
    chunks?: number
    error?: string
}

const processingQueue: Map<string, Promise<ProcessingResult>> = new Map()
const MAX_CONCURRENT = 3

async function waitForSlot() {
    while (processingQueue.size >= MAX_CONCURRENT) {
        await Promise.race(Array.from(processingQueue.values()))
    }
}

export async function processKnowledgeSource(sourceId: string, kbId: string, extractedText: string, userId: string) {
    await waitForSlot()

    const task = processSource(sourceId, kbId, extractedText, userId)
    processingQueue.set(sourceId, task)

    try {
        const result = await task
        return result
    } finally {
        processingQueue.delete(sourceId)
    }
}

async function processSource(sourceId: string, kbId: string, extractedText: string, userId: string) {
    try {
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId),
        })

        if (!user) {
            throw new Error("User not found")
        }

        const settings = user.settings || {}
        const providerId = settings.embeddingProvider

        if (!providerId) {
            throw new Error("Embedding provider not configured")
        }

        const apiKeyConfig = (settings.apiKeys || []).find(k => k.providerId === providerId)

        if (!apiKeyConfig || !apiKeyConfig.apiKey) {
            throw new Error(`API key for ${providerId} not found`)
        }

        const dimension = getVectorDimension(providerId)
        await ensureCollection(dimension)

        try {
            await qdrant.delete(CHATBOT_COLLECTION, {
                filter: {
                    must: [{ key: "sourceId", match: { value: sourceId } }]
                }
            })
        } catch {
        }

        const chunks = chunkText(extractedText)
        const embeddingModel = createEmbeddingModel(providerId, apiKeyConfig.apiKey, settings.embeddingModel)

        const { embeddings } = await embedMany({
            model: embeddingModel,
            values: chunks,
        })

        const points = chunks.map((chunk, i) => ({
            id: crypto.randomUUID(),
            vector: embeddings[i],
            payload: {
                sourceId,
                text: chunk,
                kbId,
                userId,
            },
        }))

        if (points.some(p => !Array.isArray(p.vector) || p.vector.some(v => isNaN(v)))) {
            throw new Error("One or more points have invalid vectors (not an array or contains NaN)");
        }

        try {
            await qdrant.upsert(CHATBOT_COLLECTION, {
                wait: true,
                points,
            })
        } catch (error: unknown) {
            const err = error as { status?: number; data?: unknown };
            if (err.status === 400 && err.data) {
                console.error("[Qdrant Error]", JSON.stringify(err.data, null, 2));
            }
            throw error;
        }

        await db.update(knowledgeSources)
            .set({ status: "ready" })
            .where(eq(knowledgeSources.id, sourceId))

        return { success: true, chunks: chunks.length }

    } catch (error) {
        console.error("Failed to process knowledge source:", error)

        await db.update(knowledgeSources)
            .set({ status: "failed" })
            .where(eq(knowledgeSources.id, sourceId))

        return { success: false, error: String(error) }
    }
}

export function getQueueStatus() {
    return {
        activeJobs: processingQueue.size,
        maxConcurrent: MAX_CONCURRENT,
        processingIds: Array.from(processingQueue.keys())
    }
}

