"use client"

import { useState, useEffect, useCallback } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Trash2, TestTube, Copy, ExternalLink, ArrowLeft, Webhook, MessageCircle, Hash, Gamepad2, Send } from "lucide-react"
import { toast } from "sonner"
import { use } from "react"
import { integrations, type Integration } from "@/lib/integrations"
import { WhatsAppConnector } from "@/components/whatsapp-connector"

interface Connection {
    id: string
    type: string
    name: string
    isActive: boolean
    totalMessages: number
    lastUsedAt: string | null
    config: Record<string, string>
    createdAt: string
    chatbotName?: string
}

interface ConnectionsPageProps {
    params: Promise<{ id: string }>
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    Webhook,
    MessageCircle,
    Hash,
    Gamepad2,
    Send,
}

export default function ConnectionsPage({ params }: ConnectionsPageProps) {
    const { id: chatbotId } = use(params)

    const [connections, setConnections] = useState<Connection[]>([])
    const [loading, setLoading] = useState(true)
    const [creating, setCreating] = useState(false)
    const [testing, setTesting] = useState<string | null>(null)
    const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null)

    const [showDialog, setShowDialog] = useState(false)
    const [dialogStep, setDialogStep] = useState<"select" | "configure">("select")
    const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null)
    const [name, setName] = useState("")
    const [configValues, setConfigValues] = useState<Record<string, string>>({})

    const handleDeleteConnection = async (connectionId: string) => {
        setDeleteConfirmationId(connectionId)
    }

    const confirmDeleteConnection = async () => {
        if (!deleteConfirmationId) return

        const connectionId = deleteConfirmationId
        setDeleteConfirmationId(null)

        try {
            const response = await fetch(`/api/connections?id=${connectionId}`, {
                method: "DELETE"
            })

            if (response.ok) {
                toast.success("Connection deleted")
                setConnections(connections.filter(c => c.id !== connectionId))
            } else {
                toast.error("Failed to delete connection")
            }
        } catch (error) {
            console.error("Error deleting connection:", error)
            toast.error("Error deleting connection")
        }
    }

    const fetchConnections = useCallback(async () => {
        try {
            setLoading(true)
            const response = await fetch(`/api/connections?chatbotId=${chatbotId}`)
            if (response.ok) {
                const data = await response.json()
                setConnections(data)
            } else {
                toast.error("Failed to load connections")
            }
        } catch (error) {
            console.error("Error fetching connections:", error)
            toast.error("Error loading connections")
        } finally {
            setLoading(false)
        }
    }, [chatbotId])

    useEffect(() => {
        fetchConnections()
    }, [fetchConnections])

    const handleSelectIntegration = (integration: Integration) => {
        setSelectedIntegration(integration)
        setDialogStep("configure")
        setName(`${integration.name} Connection`)
        setConfigValues({})
    }

    const handleBackToSelect = () => {
        setDialogStep("select")
        setSelectedIntegration(null)
        setName("")
        setConfigValues({})
    }

    const handleCreateConnection = async () => {
        if (!name || !selectedIntegration) {
            toast.error("Name is required")
            return
        }

        for (const field of selectedIntegration.configFields) {
            if (field.required && !configValues[field.key]) {
                toast.error(`${field.label} is required`)
                return
            }
            if (field.type === "url" && configValues[field.key]) {
                try {
                    new URL(configValues[field.key])
                } catch {
                    toast.error(`Invalid URL format for ${field.label}`)
                    return
                }
            }
        }

        try {
            setCreating(true)
            const response = await fetch("/api/connections", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: selectedIntegration.type,
                    name,
                    chatbotId,
                    config: configValues
                })
            })

            if (response.ok) {
                const newConnection = await response.json()
                toast.success(`${selectedIntegration.name} connection created!`)
                setConnections([newConnection, ...connections])

                handleCloseDialog()
            } else {
                const error = await response.json()
                toast.error(error.error || "Failed to create connection")
            }
        } catch (error) {
            console.error("Error creating connection:", error)
            toast.error("Error creating connection")
        } finally {
            setCreating(false)
        }
    }

    const handleCloseDialog = () => {
        setShowDialog(false)
        setDialogStep("select")
        setSelectedIntegration(null)
        setName("")
        setConfigValues({})
    }

    const handleTestConnection = async (connectionId: string) => {
        try {
            setTesting(connectionId)
            const response = await fetch(`/api/connections/test?id=${connectionId}`, {
                method: "POST"
            })

            const result = await response.json()

            if (result.success) {
                toast.success(`Test successful! Status: ${result.status}`)
            } else {
                toast.error(`Test failed: ${result.error || result.message}`)
            }
        } catch (error) {
            console.error("Error testing connection:", error)
            toast.error("Error sending test")
        } finally {
            setTesting(null)
        }
    }

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text)
        toast.success(`${label} copied to clipboard!`)
    }

    const getIntegrationIcon = (iconName: string) => {
        const Icon = iconMap[iconName] || Webhook
        return Icon
    }

    const getIntegrationForType = (type: string) => {
        return integrations.find(i => i.type === type)
    }

    const getWebhookUrl = (integration: Integration, connectionId?: string) => {
        if (!integration.webhookEndpoint) return null
        const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
        let endpoint = integration.webhookEndpoint
        if (connectionId) {
            endpoint = endpoint.replace("***", connectionId)
        } else {
            endpoint = endpoint.replace("***", "YOUR_CONNECTION_ID")
        }
        return `${baseUrl}${endpoint}`
    }

    return (
        <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Connections</h1>
                    <p className="text-muted-foreground mt-1">
                        Connect your chatbot to external platforms and services
                    </p>
                </div>

                <Dialog open={showDialog} onOpenChange={(open) => {
                    if (!open) handleCloseDialog()
                    else setShowDialog(true)
                }}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="h-4 w-4 mr-2" />
                            New Connection
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[700px] lg:max-w-[800px] max-h-[85vh] overflow-y-auto">
                        {dialogStep === "select" ? (
                            <>
                                <DialogHeader>
                                    <DialogTitle>Choose Integration</DialogTitle>
                                    <DialogDescription>
                                        Select a platform to connect with your chatbot
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-4">
                                    {integrations.map((integration) => {
                                        const Icon = getIntegrationIcon(integration.icon)
                                        const isAvailable = integration.status === "available" || integration.status === "beta"

                                        return (
                                            <button
                                                key={integration.type}
                                                onClick={() => isAvailable && handleSelectIntegration(integration)}
                                                disabled={!isAvailable}
                                                className={`flex flex-col items-start gap-3 p-4 rounded-lg border text-left transition-all h-full ${isAvailable
                                                    ? "hover:bg-accent hover:border-primary/50 cursor-pointer"
                                                    : "opacity-50 cursor-not-allowed"
                                                    }`}
                                            >
                                                <div className="flex items-center gap-3 w-full">
                                                    <div className={`p-2.5 rounded-lg flex-shrink-0 ${integration.type.includes("whatsapp")
                                                        ? "bg-green-500/10 text-green-600"
                                                        : integration.type === "slack"
                                                            ? "bg-purple-500/10 text-purple-600"
                                                            : integration.type === "discord"
                                                                ? "bg-indigo-500/10 text-indigo-600"
                                                                : integration.type === "telegram"
                                                                    ? "bg-blue-500/10 text-blue-600"
                                                                    : "bg-primary/10 text-primary"
                                                        }`}>
                                                        <Icon className="h-5 w-5" />
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-semibold">{integration.name}</span>
                                                        {integration.status === "beta" && (
                                                            <Badge variant="secondary" className="text-xs">Beta</Badge>
                                                        )}
                                                        {integration.status === "coming-soon" && (
                                                            <Badge variant="outline" className="text-xs">Coming Soon</Badge>
                                                        )}
                                                    </div>
                                                </div>
                                                <p className="text-sm text-muted-foreground line-clamp-2">
                                                    {integration.description}
                                                </p>
                                            </button>
                                        )
                                    })}
                                </div>
                            </>
                        ) : (
                            <>
                                <DialogHeader>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            onClick={handleBackToSelect}
                                        >
                                            <ArrowLeft className="h-4 w-4" />
                                        </Button>
                                        <div>
                                            <DialogTitle>Configure {selectedIntegration?.name}</DialogTitle>
                                            <DialogDescription>
                                                Set up your {selectedIntegration?.name} connection
                                            </DialogDescription>
                                        </div>
                                    </div>
                                </DialogHeader>

                                <div className="space-y-4 py-4">
                                    {/* Connection Name */}
                                    <div className="space-y-2">
                                        <Label htmlFor="name">Connection Name *</Label>
                                        <Input
                                            id="name"
                                            placeholder="e.g., Production WhatsApp"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                        />
                                    </div>

                                    {/* Webhook URL Info (if applicable) */}
                                    {selectedIntegration?.webhookEndpoint && (
                                        <div className="p-3 rounded-lg bg-muted/50 border">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-xs font-medium text-muted-foreground">Your Webhook URL</p>
                                                    <code className="text-sm">
                                                        {getWebhookUrl(selectedIntegration)}
                                                    </code>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() => copyToClipboard(
                                                        getWebhookUrl(selectedIntegration) || "",
                                                        "Webhook URL"
                                                    )}
                                                >
                                                    <Copy className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Dynamic Config Fields */}
                                    <div className="grid grid-cols-2 gap-4">
                                        {selectedIntegration?.configFields.map((field) => {
                                            const isWhatsApp = selectedIntegration.type === "whatsapp-business";
                                            const isSideBySide = isWhatsApp && (
                                                field.key === "phoneNumberId" ||
                                                field.key === "businessAccountId" ||
                                                field.key === "appSecret" ||
                                                field.key === "verifyToken"
                                            );

                                            return (
                                                <div key={field.key} className={`space-y-2 ${isSideBySide ? "col-span-1" : "col-span-2"}`}>
                                                    <Label htmlFor={field.key}>
                                                        {field.label} {field.required && "*"}
                                                    </Label>
                                                    {field.type === "textarea" ? (
                                                        <Textarea
                                                            id={field.key}
                                                            placeholder={field.placeholder}
                                                            value={configValues[field.key] || ""}
                                                            onChange={(e) => setConfigValues({
                                                                ...configValues,
                                                                [field.key]: e.target.value
                                                            })}
                                                            rows={3}
                                                        />
                                                     ) : (
                                                        <Input
                                                            id={field.key}
                                                            type={field.type === "password" ? "password" : field.type === "url" ? "url" : "text"}
                                                            placeholder={field.placeholder}
                                                            value={configValues[field.key] || ""}
                                                            onChange={(e) => setConfigValues({
                                                                ...configValues,
                                                                [field.key]: e.target.value
                                                            })}
                                                        />
                                                    )}
                                                    {field.helpText && (
                                                        <p className="text-xs text-muted-foreground">
                                                            {field.helpText}
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-4">
                                    <div className="text-sm text-muted-foreground">
                                        {selectedIntegration?.docsPath && (
                                            <a
                                                href={selectedIntegration.docsPath}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="hover:text-foreground underline underline-offset-4"
                                            >
                                                Read setup guide
                                            </a>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <Button variant="outline" onClick={handleCloseDialog}>
                                            Cancel
                                        </Button>
                                        <Button onClick={handleCreateConnection} disabled={creating} className="bg-primary hover:bg-primary/90">
                                            {creating ? "Creating..." : "Create Connection"}
                                        </Button>
                                    </div>
                                </div>
                            </>
                        )}
                    </DialogContent>
                </Dialog>

                {/* WhatsApp Scan Dialog */}

            </div>

            {
                loading ? (
                    <div className="flex items-center justify-center p-12 border rounded-lg bg-card/50">
                        <p className="text-muted-foreground">Loading connections...</p>
                    </div>
                ) : connections.length === 0 ? (
                    <Card className="border-dashed">
                        <CardContent className="py-12 text-center">
                            <div className="flex flex-col items-center justify-center gap-2">
                                <div className="p-4 rounded-full bg-muted/50">
                                    <Plus className="h-8 w-8 text-muted-foreground" />
                                </div>
                                <h3 className="font-semibold text-lg mt-2">No connections yet</h3>
                                <p className="text-muted-foreground mb-4 max-w-sm mx-auto">
                                    Connect your chatbot to WhatsApp, Slack, webhooks, and more.
                                </p>
                                <Button onClick={() => setShowDialog(true)}>
                                    Create First Connection
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4">
                        {connections.map((connection) => {
                            const integration = getIntegrationForType(connection.type)
                            const Icon = integration ? getIntegrationIcon(integration.icon) : Webhook

                            return (
                                <Card key={connection.id} className="overflow-hidden bg-card/50 hover:bg-card transition-colors">
                                    <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                                        <div className="flex items-start gap-3">
                                            <div className={`p-2 rounded-lg ${connection.type.includes("whatsapp")
                                                ? "bg-green-500/10 text-green-600"
                                                : connection.type === "slack"
                                                    ? "bg-purple-500/10 text-purple-600"
                                                    : connection.type === "discord"
                                                        ? "bg-indigo-500/10 text-indigo-600"
                                                        : "bg-primary/10 text-primary"
                                                }`}>
                                                <Icon className="h-5 w-5" />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <CardTitle className="text-base font-semibold">{connection.name}</CardTitle>
                                                    {connection.isActive ? (
                                                        <Badge variant="default" className="bg-green-500/15 text-green-600 hover:bg-green-500/25 border-green-500/20">Active</Badge>
                                                    ) : (
                                                        <Badge variant="secondary">Inactive</Badge>
                                                    )}
                                                </div>
                                                <CardDescription className="text-xs">
                                                    {integration?.name || connection.type} • {connection.chatbotName} • Created {new Date(connection.createdAt).toLocaleDateString()}
                                                </CardDescription>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1">
                                            {connection.type === "webhook" && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 text-xs"
                                                    onClick={() => handleTestConnection(connection.id)}
                                                    disabled={testing === connection.id}
                                                >
                                                    <TestTube className="h-3.5 w-3.5 mr-2" />
                                                    {testing === connection.id ? "Testing..." : "Test"}
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                onClick={() => handleDeleteConnection(connection.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </CardHeader>

                                    <CardContent>
                                        {connection.type === "whatsapp-native" ? (
                                            <div className="mt-2">
                                                <WhatsAppConnector connectionId={connection.id} />
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm mt-2">
                                                <div className="space-y-1">
                                                    <p className="text-xs font-medium text-muted-foreground">Total Messages</p>
                                                    <p className="font-mono">{connection.totalMessages.toLocaleString()}</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-xs font-medium text-muted-foreground">Last Used</p>
                                                    <p className="font-mono text-xs">
                                                        {connection.lastUsedAt
                                                            ? new Date(connection.lastUsedAt).toLocaleDateString()
                                                            : "-"}
                                                    </p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-xs font-medium text-muted-foreground">Connection ID</p>
                                                    <div className="flex items-center gap-2 group">
                                                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded border truncate max-w-[120px]">
                                                            {connection.id}
                                                        </code>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            onClick={() => copyToClipboard(connection.id, "Connection ID")}
                                                        >
                                                            <Copy className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-xs font-medium text-muted-foreground">Type</p>
                                                    <p className="text-xs">{integration?.name || connection.type}</p>
                                                </div>
                                            </div>
                                        )}

                                        {integration?.webhookEndpoint && (
                                            <div className="mt-6 p-3 rounded-lg bg-muted/50 border">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex-1 truncate mr-2">
                                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Webhook URL</p>
                                                        <code className="text-xs truncate block">
                                                            {getWebhookUrl(integration, connection.id)}
                                                        </code>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7"
                                                        onClick={() => copyToClipboard(
                                                            getWebhookUrl(integration, connection.id) || "",
                                                            "Webhook URL"
                                                        )}
                                                    >
                                                        <Copy className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </div>
                                        )}

                                        <div className="mt-6 pt-4 border-t flex items-center justify-between">
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                                                <span>Ready to receive events</span>
                                            </div>
                                            {integration?.docsPath && (
                                                <Button
                                                    variant="link"
                                                    size="sm"
                                                    className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                                                    onClick={() => window.open(integration.docsPath, "_blank")}
                                                >
                                                    Documentation
                                                    <ExternalLink className="h-3 w-3 ml-1" />
                                                </Button>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            )
                        })}
                    </div>
                )
            }
            <AlertDialog open={!!deleteConfirmationId} onOpenChange={(open) => !open && setDeleteConfirmationId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete your connection
                            and remove all associated data.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDeleteConnection} className={buttonVariants({ variant: "destructive" })}>
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div >
    )
}
