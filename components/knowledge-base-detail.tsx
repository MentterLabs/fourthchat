"use client"

import { addKnowledgeSource, deleteKnowledgeSource, updateKnowledgeSource, deleteKnowledgeBase, reprocessKnowledgeSource } from "@/app/actions/knowledge"
import { EmbeddingConfigForm } from "@/components/embedding-config-form"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus, FileText, ArrowLeft, RefreshCw, Pencil, Trash2, RotateCw } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export interface Source {
    id: string
    name: string
    type: string
    status: string | null
    content: string | null
    originalPath: string | null
    createdAt: Date
}

export interface KnowledgeBase {
    id: string
    name: string
    description: string | null
    sources: Source[]
}

function formatDate(date: Date): string {
    const d = new Date(date)
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

export function KnowledgeBaseDetail({ kb, hasEmbeddingConfig }: { kb: KnowledgeBase, hasEmbeddingConfig: boolean }) {
    const [open, setOpen] = useState(false)
    const [showConfigAlert, setShowConfigAlert] = useState(false)
    const [type, setType] = useState<"text" | "url" | "file">("text")
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [editingSource, setEditingSource] = useState<Source | null>(null)
    const [editName, setEditName] = useState("")
    const [editContent, setEditContent] = useState("")
    const [editOriginalPath, setEditOriginalPath] = useState("")
    const router = useRouter()

    async function handleSubmit(formData: FormData) {
        const result = await addKnowledgeSource(kb.id, formData)
        if (result?.success) {
            setOpen(false)
            router.refresh()
            toast.success("Source added successfully")
        } else if (result?.error) {
            toast.error(result.error)
        }
    }

    async function handleRefresh() {
        setIsRefreshing(true)
        router.refresh()
        setTimeout(() => setIsRefreshing(false), 1000)
    }

    async function handleDelete(sourceId: string) {
        const result = await deleteKnowledgeSource(sourceId)
        if (result?.success) {
            router.refresh()
            toast.success("Source deleted")
        } else if (result?.error) {
            toast.error(result.error)
        }
    }

    function handleEdit(source: Source) {
        setEditingSource(source)
        setEditName(source.name)
        setEditContent(source.content || "")
        setEditOriginalPath(source.originalPath || "")
    }

    async function handleEditSubmit() {
        if (!editingSource) return

        const result = await updateKnowledgeSource(editingSource.id, {
            name: editName,
            content: editingSource.type === "text" ? editContent : undefined,
            originalPath: editingSource.type === "url" ? editOriginalPath : undefined
        })

        if (result?.success) {
            setEditingSource(null)
            router.refresh()
            toast.success("Source updated")
        } else if (result?.error) {
            toast.error(result.error)
        }
    }

    async function handleDeleteKB() {
        const result = await deleteKnowledgeBase(kb.id)
        if (result?.success) {
            router.push("/dashboard/knowledge-base")
            toast.success("Knowledge base deleted")
        } else if (result?.error) {
            toast.error(result.error)
        }
    }

    async function handleReprocess(sourceId: string) {
        const result = await reprocessKnowledgeSource(sourceId)
        if (result?.success) {
            router.refresh()
            toast.success("Reprocessing started")
        } else if (result?.error) {
            toast.error(result.error)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3">
                    <Link href="/dashboard/knowledge-base">
                        <Button variant="ghost" size="icon" className="shrink-0">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold">{kb.name}</h1>
                        <p className="text-muted-foreground text-sm">{kb.description}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 md:ml-10 md:ml-auto">
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="outline" size="icon" className="h-9 w-9 border-destructive text-destructive hover:bg-destructive/10">
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Delete &quot;{kb.name}&quot;?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will permanently delete this knowledge base and all its sources. This action cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={handleDeleteKB}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    Delete
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing} className="h-9 ml-2">
                        <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Dialog open={showConfigAlert} onOpenChange={setShowConfigAlert}>
                        <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>Configure Embedding Model</DialogTitle>
                                <DialogDescription>
                                    You need an embedding model to process knowledge sources. Configure it below.
                                </DialogDescription>
                            </DialogHeader>
                            <EmbeddingConfigForm
                                onSuccess={() => {
                                    setShowConfigAlert(false)
                                    setOpen(true)
                                }}
                            />
                        </DialogContent>
                    </Dialog>

                    <Dialog open={open} onOpenChange={(val) => {
                        if (val && !hasEmbeddingConfig) {
                            setShowConfigAlert(true)
                            return
                        }
                        setOpen(val)
                    }}>
                        <DialogTrigger asChild>
                            <Button size="sm" className="h-9">
                                <Plus className="h-4 w-4" />
                                Add Source
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[500px]">
                            <DialogHeader>
                                <DialogTitle>Add Knowledge Source</DialogTitle>
                                <DialogDescription>
                                    Add text or content for your bot to learn.
                                </DialogDescription>
                            </DialogHeader>
                            <form action={handleSubmit}>
                                <div className="grid gap-4 py-4">
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="type" className="text-right">
                                            Type
                                        </Label>
                                        <div className="col-span-3 flex gap-2">
                                            <Button
                                                type="button"
                                                variant={type === "text" ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => setType("text")}
                                            >
                                                Text
                                            </Button>
                                            <Button
                                                type="button"
                                                variant={type === "url" ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => setType("url")}
                                            >
                                                URL
                                            </Button>
                                            <Button
                                                type="button"
                                                variant={type === "file" ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => setType("file")}
                                            >
                                                Files
                                            </Button>
                                        </div>
                                        <input type="hidden" name="type" value={type} />
                                    </div>

                                    {type !== "file" && (
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="name" className="text-right">
                                                Name
                                            </Label>
                                            <Input
                                                id="name"
                                                name="name"
                                                placeholder="e.g. My Source"
                                                className="col-span-3"
                                                required
                                            />
                                        </div>
                                    )}

                                    {type === "text" && (
                                        <div className="grid grid-cols-4 items-start gap-4">
                                            <Label htmlFor="content" className="text-right pt-2">
                                                Content
                                            </Label>
                                            <Textarea
                                                id="content"
                                                name="content"
                                                placeholder="Paste your text here..."
                                                className="col-span-3 min-h-[150px]"
                                                required
                                            />
                                        </div>
                                    )}

                                    {type === "url" && (
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="content" className="text-right">
                                                URL
                                            </Label>
                                            <Input
                                                id="content"
                                                name="content"
                                                placeholder="https://example.com"
                                                className="col-span-3"
                                                required
                                            />
                                        </div>
                                    )}

                                    {type === "file" && (
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="file" className="text-right">
                                                Files
                                            </Label>
                                            <Input
                                                id="file"
                                                name="file"
                                                type="file"
                                                multiple
                                                accept=".pdf,.docx,.xlsx,.txt,.md,.csv"
                                                className="col-span-3"
                                                required
                                            />
                                        </div>
                                    )}

                                </div>
                                <DialogFooter>
                                    <Button type="submit">Add Source</Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="border rounded-xl bg-card overflow-hidden">
                <div className="overflow-x-auto">
                    <div className="min-w-[600px]">
                        <div className="p-4 rounded-t-xl border-b bg-muted/40 font-medium grid grid-cols-12 gap-4 text-sm text-muted-foreground">
                            <div className="col-span-5">Name</div>
                            <div className="col-span-2">Type</div>
                            <div className="col-span-2">Status</div>
                            <div className="col-span-2">Added</div>
                            <div className="col-span-1"></div>
                        </div>
                        <div className="divide-y">
                            {kb.sources.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground">
                                    No sources yet. Add one to get started.
                                </div>
                            ) : (
                                kb.sources.map((source) => (
                                    <div key={source.id} className="p-4 grid grid-cols-12 gap-4 items-center text-sm">
                                        <div className="col-span-5 font-medium flex items-center gap-2">
                                            <FileText className="h-4 w-4 text-blue-500" />
                                            {source.name}
                                        </div>
                                        <div className="col-span-2 capitalize">{source.type}</div>
                                        <div className="col-span-2">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${source.status === 'ready' ? 'bg-green-100 text-green-800' :
                                                source.status === 'failed' ? 'bg-red-100 text-red-800' :
                                                    'bg-yellow-100 text-yellow-800'
                                                }`}>
                                                {source.status}
                                            </span>
                                        </div>
                                        <div className="col-span-2 text-muted-foreground">
                                            {formatDate(source.createdAt)}
                                        </div>
                                        <div className="col-span-1 flex justify-end gap-1">
                                            {source.status === "failed" && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-orange-600 hover:text-orange-700 hover:bg-orange-100"
                                                    onClick={() => handleReprocess(source.id)}
                                                    title="Reprocess"
                                                >
                                                    <RotateCw className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => handleEdit(source)}
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Delete &quot;{source.name}&quot;?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            This will permanently delete this source and its embeddings. This cannot be undone.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            onClick={() => handleDelete(source.id)}
                                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                        >
                                                            Delete
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Edit Dialog */}
            <Dialog open={!!editingSource} onOpenChange={(open) => !open && setEditingSource(null)}>
                <DialogContent className="sm:max-w-2xl h-[80vh] flex flex-col p-6">
                    <DialogHeader className="shrink-0">
                        <DialogTitle>Edit Source</DialogTitle>
                        <DialogDescription>
                            Update the name of your knowledge source.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 flex flex-col gap-4 py-4 min-h-0 overflow-hidden">
                        <div className="shrink-0 grid gap-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="edit-name" className="text-right">
                                    Name
                                </Label>
                                <Input
                                    id="edit-name"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="col-span-3"
                                />
                            </div>

                            {editingSource?.type === "file" && (
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">File</Label>
                                    <div className="col-span-3 text-sm text-muted-foreground italic">
                                        {editingSource.originalPath}
                                    </div>
                                </div>
                            )}

                            {editingSource?.type === "url" && (
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="edit-url" className="text-right">
                                        URL
                                    </Label>
                                    <div className="col-span-3 space-y-2">
                                        <Input
                                            id="edit-url"
                                            value={editOriginalPath}
                                            onChange={(e) => setEditOriginalPath(e.target.value)}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-h-0 grid grid-cols-4 gap-4">
                            <Label htmlFor="edit-content" className="text-right mt-2">
                                Content
                            </Label>
                            <div className="col-span-3 h-full flex flex-col gap-2 min-h-0">
                                <Textarea
                                    id="edit-content"
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                    className="flex-1 resize-none font-mono text-sm"
                                />
                                {editingSource?.type !== "text" && (
                                    <p className="text-xs text-muted-foreground bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded border border-yellow-200 dark:border-yellow-900 shrink-0">
                                        Note: You are editing the text extracted from the {editingSource?.type}.
                                        This is what the AI uses to answer questions.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="shrink-0">
                        <Button variant="outline" onClick={() => setEditingSource(null)}>
                            Cancel
                        </Button>
                        <Button onClick={handleEditSubmit}>
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

