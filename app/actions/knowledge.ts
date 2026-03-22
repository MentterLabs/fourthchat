"use server"

import { auth } from "@/auth"
import { db } from "@/lib/db"
import { knowledgeBases, knowledgeSources, users } from "@/lib/schema"
import { eq, desc, and } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { extractTextFromPdf, extractTextFromUrl, extractTextFromDocx, extractTextFromXlsx, extractTextFromTextFile } from "@/lib/source-processor"


const createKnowledgeBaseSchema = z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    visibility: z.enum(["private", "shared", "public"]).default("private"),
})


export async function getKnowledgeBases() {
    const session = await auth()
    if (!session?.user?.id) return []

    try {
        const kbs = await db.query.knowledgeBases.findMany({
            where: eq(knowledgeBases.userId, session.user.id),
            orderBy: [desc(knowledgeBases.createdAt)],
            with: {
                sources: true
            }
        })
        return kbs.map(kb => ({
            ...kb,
            _count: {
                sources: kb.sources.length
            }
        }))
    } catch (e) {
        console.error("Error fetching KBs:", e)
        return []
    }
}

export async function createKnowledgeBase(formData: FormData) {
    const session = await auth()

    if (!session?.user?.id) {
        return { error: "Unauthorized" }
    }

    const name = formData.get("name") as string
    const description = formData.get("description") as string

    const result = createKnowledgeBaseSchema.safeParse({ name, description })

    if (!result.success) {
        return { error: "Invalid data" }
    }

    try {
        await db.insert(knowledgeBases).values({
            userId: session.user.id,
            name: result.data.name,
            description: result.data.description,
            visibility: "private",
        })

        revalidatePath("/dashboard/knowledge-base")
        return { success: true }
    } catch (error) {
        console.error("Failed to create KB:", error)
        return { error: error instanceof Error ? error.message : "Failed to create knowledge base" }
    }
}

export async function getKnowledgeBase(kbId: string) {
    const session = await auth()
    if (!session?.user?.id) return null

    const kb = await db.query.knowledgeBases.findFirst({
        where: and(
            eq(knowledgeBases.id, kbId),
            eq(knowledgeBases.userId, session.user.id)
        ),
        with: {
            sources: true,
        }
    })

    if (kb && !kb['sources']) {
        const sources = await db.query.knowledgeSources.findMany({
            where: eq(knowledgeSources.knowledgeBaseId, kb.id),
            orderBy: [desc(knowledgeSources.createdAt)],
        })
        return { ...kb, sources }
    }

    return kb
}

export async function addKnowledgeSource(kbId: string, formData: FormData) {
    const session = await auth()
    if (!session?.user?.id) return { error: "Unauthorized" }

    const type = formData.get("type") as "text" | "url" | "file"
    const nameInput = formData.get("name") as string

    if (!type) return { error: "Missing required fields" }

    const user = await db.query.users.findFirst({
        where: eq(users.id, session.user.id)
    })
    const settings = user?.settings || {}
    if (!settings.embeddingProvider) {
        return { error: "Please configure an Embedding Model in Settings > Models before adding knowledge." }
    }

    try {
        const sourceIds: string[] = []

        if (type === "file") {
            const files = formData.getAll("file") as File[]
            if (files.length === 0) return { error: "No files uploaded" }

            for (const file of files) {
                let extractedText = ""
                const buffer = Buffer.from(await file.arrayBuffer())
                const ext = file.name.split('.').pop()?.toLowerCase() || ""
                const mime = file.type

                if (mime === "application/pdf" || ext === "pdf") {
                    extractedText = await extractTextFromPdf(buffer)
                } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === "docx") {
                    extractedText = await extractTextFromDocx(buffer)
                } else if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || ext === "xlsx") {
                    extractedText = await extractTextFromXlsx(buffer)
                } else if (mime.startsWith("text/") || ["txt", "md", "csv"].includes(ext)) {
                    extractedText = await extractTextFromTextFile(buffer)
                } else {
                    console.warn(`Skipping unsupported file type: ${file.name} (${mime})`)
                    continue
                }

                if (!extractedText.trim()) continue

                const [source] = await db.insert(knowledgeSources).values({
                    knowledgeBaseId: kbId,
                    name: file.name,
                    type: "file",
                    content: extractedText,
                    originalPath: file.name,
                    lastSyncedAt: new Date(),
                    status: "processing",
                }).returning()

                sourceIds.push(source.id)

                const { processKnowledgeSource } = await import("@/lib/knowledge-processor")
                processKnowledgeSource(source.id, kbId, extractedText, session.user!.id!).catch(console.error)
            }
        } else if (type === "url") {
            const contentInput = formData.get("content") as string
            const extractedText = await extractTextFromUrl(contentInput)
            if (!extractedText.trim()) return { error: "No text extracted from URL" }

            const [source] = await db.insert(knowledgeSources).values({
                knowledgeBaseId: kbId,
                name: nameInput || contentInput,
                type: "url",
                content: extractedText,
                originalPath: contentInput,
                lastSyncedAt: new Date(),
                status: "processing",
            }).returning()
            sourceIds.push(source.id)
            const { processKnowledgeSource } = await import("@/lib/knowledge-processor")
            processKnowledgeSource(source.id, kbId, extractedText, session.user!.id!).catch(console.error)
        } else if (type === "text") {
            const contentInput = formData.get("content") as string
            const [source] = await db.insert(knowledgeSources).values({
                knowledgeBaseId: kbId,
                name: nameInput || "Text Note",
                type: "text",
                content: contentInput,
                originalPath: "text_input",
                lastSyncedAt: new Date(),
                status: "processing",
            }).returning()
            sourceIds.push(source.id)
            const { processKnowledgeSource } = await import("@/lib/knowledge-processor")
            processKnowledgeSource(source.id, kbId, contentInput, session.user!.id!).catch(console.error)
        }

        if (sourceIds.length === 0) {
            return { error: "No valid sources were added" }
        }

        revalidatePath(`/dashboard/knowledge-base/${kbId}`)
        return { success: true, count: sourceIds.length }

    } catch (error) {
        console.error("Failed to add source:", error)
        return { error: "Failed to process source" }
    }
}


export async function deleteKnowledgeSource(sourceId: string) {
    const session = await auth()
    if (!session?.user?.id) return { error: "Unauthorized" }

    try {
        const source = await db.query.knowledgeSources.findFirst({
            where: eq(knowledgeSources.id, sourceId),
        })

        if (!source) {
            return { error: "Source not found" }
        }

        const { qdrant, CHATBOT_COLLECTION } = await import("@/lib/qdrant")
        try {
            await qdrant.delete(CHATBOT_COLLECTION, {
                filter: {
                    must: [{ key: "sourceId", match: { value: sourceId } }]
                }
            })
        } catch {
        }

        await db.delete(knowledgeSources).where(eq(knowledgeSources.id, sourceId))

        revalidatePath(`/dashboard/knowledge-base/${source.knowledgeBaseId}`)
        return { success: true }
    } catch (error) {
        console.error("Failed to delete source:", error)
        return { error: "Failed to delete source" }
    }
}

export async function updateKnowledgeSource(sourceId: string, data: { name?: string, content?: string, originalPath?: string }) {
    const session = await auth()
    if (!session?.user?.id) return { error: "Unauthorized" }

    try {
        const source = await db.query.knowledgeSources.findFirst({
            where: eq(knowledgeSources.id, sourceId),
        })

        if (!source) {
            return { error: "Source not found" }
        }

        const updates: Partial<typeof knowledgeSources.$inferSelect> = {}
        if (data.name) updates.name = data.name

        let newContent = data.content

        if (data.originalPath && data.originalPath !== source.originalPath && source.type === 'url') {
            updates.originalPath = data.originalPath
            newContent = await extractTextFromUrl(data.originalPath)
        }

        if (newContent && newContent !== source.content) {
            updates.content = newContent
            updates.status = "processing"
            updates.lastSyncedAt = new Date()

            import("@/lib/knowledge-processor").then(({ processKnowledgeSource }) => {
                processKnowledgeSource(source.id, source.knowledgeBaseId, newContent!, session.user!.id!).catch(console.error)
            })
        }

        if (Object.keys(updates).length > 0) {
            await db.update(knowledgeSources)
                .set(updates)
                .where(eq(knowledgeSources.id, sourceId))
        }

        revalidatePath(`/dashboard/knowledge-base/${source.knowledgeBaseId}`)
        return { success: true }
    } catch (error) {
        console.error("Failed to update source:", error)
        return { error: "Failed to update source" }
    }
}

export async function deleteKnowledgeBase(kbId: string) {
    const session = await auth()
    if (!session?.user?.id) return { error: "Unauthorized" }

    try {
        const kb = await db.query.knowledgeBases.findFirst({
            where: and(
                eq(knowledgeBases.id, kbId),
                eq(knowledgeBases.userId, session.user.id)
            ),
            with: {
                sources: true,
            }
        })

        if (!kb) {
            return { error: "Knowledge base not found" }
        }

        const { qdrant, CHATBOT_COLLECTION } = await import("@/lib/qdrant")
        for (const source of kb.sources || []) {
            try {
                await qdrant.delete(CHATBOT_COLLECTION, {
                    filter: {
                        must: [{ key: "sourceId", match: { value: source.id } }]
                    }
                })
            } catch {
            }
        }

        await db.delete(knowledgeSources).where(eq(knowledgeSources.knowledgeBaseId, kbId))
        await db.delete(knowledgeBases).where(eq(knowledgeBases.id, kbId))

        revalidatePath("/dashboard/knowledge-base")
        return { success: true }
    } catch (error) {
        console.error("Failed to delete knowledge base:", error)
        return { error: "Failed to delete knowledge base" }
    }
}

export async function reprocessKnowledgeSource(sourceId: string) {
    const session = await auth()
    if (!session?.user?.id) return { error: "Unauthorized" }

    try {
        const source = await db.query.knowledgeSources.findFirst({
            where: eq(knowledgeSources.id, sourceId),
        })

        if (!source) {
            return { error: "Source not found" }
        }

        if (!source.content) {
            return { error: "No content to process. Please edit and add content first." }
        }

        await db.update(knowledgeSources)
            .set({
                status: "processing",
                lastSyncedAt: new Date()
            })
            .where(eq(knowledgeSources.id, sourceId))

        import("@/lib/knowledge-processor").then(({ processKnowledgeSource }) => {
            processKnowledgeSource(source.id, source.knowledgeBaseId, source.content!, session.user!.id!).catch(console.error)
        })

        revalidatePath(`/dashboard/knowledge-base/${source.knowledgeBaseId}`)
        return { success: true }
    } catch (error) {
        console.error("Failed to reprocess source:", error)
        return { error: "Failed to reprocess source" }
    }
}

