import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { bot } from "../chat";
import { connections } from "@/lib/schema";
import { createDiscordAdapter, DiscordAdapter } from "@chat-adapter/discord";
import { DiscordConfig } from "../types";

class DiscordManager {
    private sessions: Map<string, { adapter: DiscordAdapter, stop: () => void }> = new Map();

    constructor() { }

    public async connectAll() {
        try {
            const activeConfigs = await db.query.connections.findMany({
                where: and(
                    eq(connections.type, "discord"),
                    eq(connections.isActive, true)
                )
            });

            for (const connection of activeConfigs) {
                await this.connect(connection.id);
            }
        } catch (error) {
            console.error("[Discord Manager] Failed to connect all bots:", error);
        }
    }

    public async connect(connectionId: string) {
        if (this.sessions.has(connectionId)) {
            console.log(`[Discord Manager] Bot ${connectionId} already connected, skipping`);
            return;
        }

        try {
            const connection = await db.query.connections.findFirst({
                where: eq(connections.id, connectionId)
            });

            if (!connection || connection.type !== "discord" || !connection.isActive) {
                return;
            }

            const config = (connection.config as unknown) as DiscordConfig;
            if (config.type !== "discord" || !config.botToken || !config.applicationId || !config.publicKey) {
                console.warn(`[Discord Manager] Missing config for bot ${connectionId}`);
                return;
            }

            const adapter = createDiscordAdapter({
                applicationId: config.applicationId,
                botToken: config.botToken,
                publicKey: config.publicKey,
            });

            await adapter.initialize(bot);

            const controller = new AbortController();
            const FOREVER_MS = 2147483647;

            const discordAdapter = adapter as DiscordAdapter;

            discordAdapter.startGatewayListener({
                waitUntil: (task: Promise<unknown>) => task.catch(e => console.error("[Discord Manager] Gateway Listener Task Error:", e))
            }, FOREVER_MS, controller.signal).catch(err => {
                console.error("[Discord Manager] Gateway listener failed to start:", err);
            });

            await this.registerSlashCommands(discordAdapter, config.applicationId, config.botToken);

            this.sessions.set(connectionId, {
                adapter,
                stop: () => controller.abort()
            });

        } catch (error) {
            console.error(`[Discord Manager] Failed to connect bot ${connectionId}:`, error);
        }
    }

    private async registerSlashCommands(adapter: DiscordAdapter, applicationId: string, botToken: string) {
        try {
            const url = `https://discord.com/api/v10/applications/${applicationId}/commands`;
            const response = await fetch(url, {
                method: "PUT",
                headers: {
                    "Authorization": `Bot ${botToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify([
                    {
                        name: "chat",
                        description: "Chat with the AI agent",
                        options: [
                            {
                                type: 3, // STRING
                                name: "message",
                                description: "The message to send to the AI",
                                required: true
                            }
                        ]
                    }
                ])
            });

            if (!response.ok) {
                const error = await response.text();
                console.warn("[Discord Manager] Failed to register slash commands:", error);
            }
        } catch (error) {
            console.error("[Discord Manager] Error registering slash commands:", error);
        }
    }

    public disconnect(connectionId: string) {
        const session = this.sessions.get(connectionId);
        if (session) {
            session.stop();
            this.sessions.delete(connectionId);
            console.log(`[Discord Manager] Bot ${connectionId} disconnected`);
        }
    }
}

const globalForDiscord = globalThis as unknown as { discordManager: DiscordManager }

const discordManager = globalForDiscord.discordManager || new DiscordManager()

if (process.env.NODE_ENV !== "production") globalForDiscord.discordManager = discordManager

export default discordManager
