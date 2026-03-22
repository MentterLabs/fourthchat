"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSession } from "next-auth/react"
import { User, Key, Cpu, Shield, Eye, EyeOff, Check } from "lucide-react"
import { toast } from "sonner"

import { AI_PROVIDERS } from "@/lib/ai-providers"

interface ApiKeyConfig {
    providerId: string
    apiKey: string
    isEnabled: boolean
    selectedModel: string
}

export default function SettingsPage() {
    const searchParams = useSearchParams()
    const defaultTab = searchParams.get("tab") || "models"
    const { data: session, update: updateSession } = useSession()
    const user = session?.user

    const [apiKeys, setApiKeys] = useState<ApiKeyConfig[]>([])
    const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
    const [saving, setSaving] = useState(false)
    const [defaultProvider, setDefaultProvider] = useState("gemini")
    const [embeddingProvider, setEmbeddingProvider] = useState("")
    const [embeddingModel, setEmbeddingModel] = useState("")

    // Profile state
    const [profileName, setProfileName] = useState("")
    const [savingProfile, setSavingProfile] = useState(false)

    // Security state
    const [currentPassword, setCurrentPassword] = useState("")
    const [newPassword, setNewPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [savingPassword, setSavingPassword] = useState(false)

    useEffect(() => {
        loadApiKeys()
    }, [])

    useEffect(() => {
        if (user?.name) {
            setProfileName(user.name)
        }
    }, [user?.name])

    const loadApiKeys = async () => {
        try {
            const response = await fetch("/api/settings/api-keys")
            if (response.ok) {
                const data = await response.json()
                setApiKeys(data.apiKeys || [])
                setDefaultProvider(data.defaultProvider || "gemini")
                setEmbeddingProvider(data.embeddingProvider || "")
                setEmbeddingModel(data.embeddingModel || "")
            }
        } catch (error) {
            console.error("Failed to load API keys:", error)
        }
    }

    const saveApiKeys = async () => {
        setSaving(true)
        try {
            const response = await fetch("/api/settings/api-keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKeys, defaultProvider, embeddingProvider, embeddingModel })
            })
            if (response.ok) {
                toast.success("API keys saved successfully")
            } else {
                toast.error("Failed to save API keys")
            }
        } catch (error) {
            toast.error("Error saving API keys")
            console.error("Error saving API keys:", error)
        } finally {
            setSaving(false)
        }
    }

    const updateApiKey = (providerId: string, updates: Partial<ApiKeyConfig>) => {
        setApiKeys(prev => {
            const existing = prev.find(k => k.providerId === providerId)
            if (existing) {
                return prev.map(k => k.providerId === providerId ? { ...k, ...updates } : k)
            } else {
                const provider = AI_PROVIDERS.find(p => p.id === providerId)
                return [...prev, {
                    providerId,
                    apiKey: "",
                    isEnabled: true,
                    selectedModel: provider?.models[0]?.id || "",
                    ...updates
                }]
            }
        })
    }

    const getApiKeyConfig = (providerId: string): ApiKeyConfig | undefined => {
        return apiKeys.find(k => k.providerId === providerId)
    }

    const toggleShowKey = (providerId: string) => {
        setShowKeys(prev => ({ ...prev, [providerId]: !prev[providerId] }))
    }

    const saveProfile = async () => {
        if (!profileName.trim()) {
            toast.error("Name cannot be empty")
            return
        }
        setSavingProfile(true)
        try {
            const response = await fetch("/api/settings/profile", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: profileName.trim() })
            })
            if (response.ok) {
                toast.success("Profile updated successfully")
                await updateSession({ name: profileName.trim() })
            } else {
                const data = await response.json()
                toast.error(data.error || "Failed to update profile")
            }
        } catch (error) {
            toast.error("Error updating profile")
            console.error("Error updating profile:", error)
        } finally {
            setSavingProfile(false)
        }
    }

    const updatePasswordHandler = async () => {
        if (!currentPassword) {
            toast.error("Current password is required")
            return
        }
        if (newPassword.length < 6) {
            toast.error("New password must be at least 6 characters")
            return
        }
        if (newPassword !== confirmPassword) {
            toast.error("Passwords do not match")
            return
        }
        setSavingPassword(true)
        try {
            const response = await fetch("/api/settings/password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword, newPassword })
            })
            if (response.ok) {
                toast.success("Password updated successfully")
                setCurrentPassword("")
                setNewPassword("")
                setConfirmPassword("")
            } else {
                const data = await response.json()
                toast.error(data.error || "Failed to update password")
            }
        } catch (error) {
            toast.error("Error updating password")
            console.error("Error updating password:", error)
        } finally {
            setSavingPassword(false)
        }
    }

    return (
        <div className="flex flex-1 flex-col gap-6">
            <div>
                <h1 className="text-2xl font-bold">Settings</h1>
                <p className="text-muted-foreground">Manage your AI providers, API keys, and account settings.</p>
            </div>

            <Tabs defaultValue={defaultTab} className="space-y-6">
                <TabsList className="h-auto p-1 bg-muted/50 rounded-lg flex-wrap">
                    <TabsTrigger value="models" className="gap-2 data-[state=active]:bg-background">
                        <Cpu className="h-4 w-4" />
                        Models & Keys
                    </TabsTrigger>
                    <TabsTrigger value="profile" className="gap-2 data-[state=active]:bg-background">
                        <User className="h-4 w-4" />
                        Profile
                    </TabsTrigger>
                    <TabsTrigger value="security" className="gap-2 data-[state=active]:bg-background">
                        <Shield className="h-4 w-4" />
                        Security
                    </TabsTrigger>
                </TabsList>

                {/* Models & Keys Tab */}
                <TabsContent value="models" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Key className="h-5 w-5" />
                                AI Provider API Keys
                            </CardTitle>
                            <CardDescription>
                                Configure API keys and default models for different AI providers.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-8">
                            {/* Global Settings Section */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg bg-muted/50">
                                <div className="space-y-1">
                                    <Label className="text-base">Default AI Provider</Label>
                                    <p className="text-sm text-muted-foreground">Select the primary AI provider for new chats.</p>
                                </div>
                                <Select value={defaultProvider} onValueChange={setDefaultProvider}>
                                    <SelectTrigger className="w-full sm:w-[240px] bg-background">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {AI_PROVIDERS.map((provider) => (
                                            <SelectItem key={provider.id} value={provider.id}>
                                                {provider.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Providers Grid */}
                            <div className="grid gap-6 xl:grid-cols-2">
                                {AI_PROVIDERS.map((provider) => {
                                    const config = getApiKeyConfig(provider.id)
                                    const hasKey = config?.apiKey && config.apiKey.length > 0
                                    const isEnabled = config?.isEnabled ?? false

                                    return (
                                        <div
                                            key={provider.id}
                                            className={`flex flex-col rounded-xl border transition-all duration-200 ${isEnabled ? "bg-card shadow-sm border-border" : "bg-muted/20 border-border/50 opacity-75"
                                                }`}
                                        >
                                            {/* Provider Header */}
                                            <div className="flex items-center justify-between p-4 border-b bg-muted/30 rounded-t-xl">
                                                <div className="flex items-center gap-3">
                                                    <div className={`p-2 rounded-lg ${isEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                                                        <Cpu className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="font-semibold text-sm">{provider.name}</h4>
                                                            {hasKey && isEnabled && (
                                                                <Badge variant="outline" className="h-5 px-1.5 bg-green-500/10 text-green-600 border-green-200 dark:border-green-900 text-[10px] uppercase font-bold tracking-wider">
                                                                    Active
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <Switch
                                                    checked={isEnabled}
                                                    onCheckedChange={(checked) => updateApiKey(provider.id, { isEnabled: checked })}
                                                    disabled={!hasKey}
                                                    aria-label={`Toggle ${provider.name}`}
                                                />
                                            </div>

                                            {/* Provider Body */}
                                            <div className="p-4 space-y-4 flex-1">
                                                <div className="space-y-2">
                                                    <Label htmlFor={`${provider.id}-key`} className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                                        API Key
                                                    </Label>
                                                    <div className="relative">
                                                        <Input
                                                            id={`${provider.id}-key`}
                                                            type={showKeys[provider.id] ? "text" : "password"}
                                                            placeholder={provider.placeholder}
                                                            value={config?.apiKey || ""}
                                                            onChange={(e) => updateApiKey(provider.id, { apiKey: e.target.value })}
                                                            className="pr-10 font-mono text-sm bg-background/50"
                                                        />
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground"
                                                            onClick={() => toggleShowKey(provider.id)}
                                                        >
                                                            {showKeys[provider.id] ? (
                                                                <EyeOff className="h-4 w-4" />
                                                            ) : (
                                                                <Eye className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>

                                                <div className="space-y-2">
                                                    <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                                        Default Model
                                                    </Label>
                                                    <Select
                                                        value={config?.selectedModel || provider.models[0]?.id}
                                                        onValueChange={(value) => updateApiKey(provider.id, { selectedModel: value })}
                                                    >
                                                        <SelectTrigger className="bg-background/50">
                                                            <SelectValue placeholder="Select model" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {provider.models.map((model) => (
                                                                <SelectItem key={model.id} value={model.id}>
                                                                    <div className="flex flex-col py-0.5">
                                                                        <span className="font-medium text-sm">{model.name}</span>
                                                                        <span className="text-[10px] text-muted-foreground">{model.description}</span>
                                                                    </div>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>

                                            {/* Provider Footer */}
                                            <div className="px-4 py-3 bg-muted/10 border-t rounded-b-xl flex justify-between items-center text-xs text-muted-foreground">
                                                <span className="line-clamp-1 max-w-[70%] opacity-80">{provider.description}</span>
                                                <a
                                                    href={provider.docsUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="font-medium hover:text-primary transition-colors flex items-center gap-1"
                                                >
                                                    Get Key
                                                    <span className="sr-only">for {provider.name}</span>
                                                    <span aria-hidden="true">→</span>
                                                </a>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            <div className="flex justify-end pt-2">
                                <Button onClick={saveApiKeys} disabled={saving} size="lg" className="w-full sm:w-auto min-w-[150px]">
                                    {saving ? (
                                        <>
                                            <span className="animate-spin mr-2">•</span> Saving...
                                        </>
                                    ) : (
                                        <>
                                            <Check className="w-4 h-4 mr-2" />
                                            Save Changes
                                        </>
                                    )}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Cpu className="h-5 w-5" />
                                Embedding Configuration
                            </CardTitle>
                            <CardDescription>
                                Select the AI provider and model used for generating embeddings (RAG).
                                <br />
                                <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                                    Warning: Changing this will require re-indexing your entire knowledge base.
                                </span>
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Embedding Provider</Label>
                                    <Select
                                        value={embeddingProvider}
                                        onValueChange={(value) => {
                                            setEmbeddingProvider(value)
                                            // Reset model when provider changes
                                            if (value === "openai") setEmbeddingModel("text-embedding-3-small")
                                            if (value === "gemini") setEmbeddingModel("gemini-embedding-001")
                                        }}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select provider" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="openai">OpenAI</SelectItem>
                                            <SelectItem value="gemini">Google Gemini</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label>Embedding Model</Label>
                                    <Select value={embeddingModel} onValueChange={setEmbeddingModel}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select model" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {embeddingProvider === "openai" && (
                                                <>
                                                    <SelectItem value="text-embedding-3-small">Text Embedding 3 Small</SelectItem>
                                                    <SelectItem value="text-embedding-3-large">Text Embedding 3 Large</SelectItem>
                                                </>
                                            )}
                                            {embeddingProvider === "gemini" && (
                                                <>
                                                    <SelectItem value="gemini-embedding-001">Gemini Embedding 001</SelectItem>
                                                </>
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <Button onClick={saveApiKeys} disabled={saving}>
                                    {saving ? "Saving..." : "Save Embedding Settings"}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>


                </TabsContent>

                {/* Profile Tab */}
                <TabsContent value="profile" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Profile Information</CardTitle>
                            <CardDescription>
                                Update your profile details and avatar.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center gap-6">
                                <Avatar className="h-20 w-20">
                                    <AvatarImage src={user?.image || ""} alt={user?.name || ""} />
                                    <AvatarFallback className="text-2xl">{user?.name?.[0] || "U"}</AvatarFallback>
                                </Avatar>
                                <div className="space-y-2">
                                    <h3 className="font-medium">{user?.name}</h3>
                                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                                </div>
                            </div>

                            <div className="grid gap-4 max-w-md">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Name</Label>
                                    <Input
                                        id="name"
                                        value={profileName}
                                        onChange={(e) => setProfileName(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email</Label>
                                    <Input id="email" type="email" defaultValue={user?.email || ""} disabled />
                                    <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
                                </div>
                            </div>

                            <Button onClick={saveProfile} disabled={savingProfile}>
                                {savingProfile ? "Saving..." : "Save Changes"}
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Security Tab */}
                <TabsContent value="security" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Security Settings</CardTitle>
                            <CardDescription>
                                Manage your password and security preferences.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 max-w-md">
                                <div className="space-y-2">
                                    <Label htmlFor="current-password">Current Password</Label>
                                    <Input
                                        id="current-password"
                                        type="password"
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="new-password">New Password</Label>
                                    <Input
                                        id="new-password"
                                        type="password"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="confirm-password">Confirm New Password</Label>
                                    <Input
                                        id="confirm-password"
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                    />
                                </div>
                            </div>

                            <Button onClick={updatePasswordHandler} disabled={savingPassword}>
                                {savingPassword ? "Updating..." : "Update Password"}
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}

