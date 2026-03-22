import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WASocket,
    ConnectionState
} from "@whiskeysockets/baileys"
import { pino } from "pino"
import { eq, and } from "drizzle-orm"
import { db } from "@/lib/db"
import { bot, state as chatState } from "../chat"
import { connections } from "@/lib/schema"
import { createDrizzleAuthState } from "./auth"
import { BaileysAdapter } from "../chat/adapters/baileys-adapter"

export type WhatsAppStatus = "connecting" | "connected" | "disconnected" | "qr_ready"

interface SessionData {
    socket: WASocket | null
    qrCode: string | null
    status: WhatsAppStatus
    lastError?: string
}

class WhatsAppManager {
    private sessions: Map<string, SessionData> = new Map()
    private listeners: Map<string, ((status: WhatsAppStatus, qr: string | null, error?: string) => void)[]> = new Map()
    private messageQueues: Map<string, Promise<void>> = new Map()

    constructor() { }

    private getSession(connectionId: string): SessionData {
        if (!this.sessions.has(connectionId)) {
            this.sessions.set(connectionId, {
                socket: null,
                qrCode: null,
                status: "disconnected",
                lastError: undefined
            })
        }
        return this.sessions.get(connectionId)!
    }

    public subscribe(connectionId: string, callback: (status: WhatsAppStatus, qr: string | null, error?: string) => void) {
        if (!this.listeners.has(connectionId)) {
            this.listeners.set(connectionId, [])
        }
        this.listeners.get(connectionId)!.push(callback)

        const session = this.getSession(connectionId)
        callback(session.status, session.qrCode, session.lastError)

        return () => {
            const list = this.listeners.get(connectionId)
            if (list) {
                this.listeners.set(connectionId, list.filter(l => l !== callback))
            }
        }
    }

    private notify(connectionId: string) {
        const session = this.getSession(connectionId)
        const list = this.listeners.get(connectionId)
        if (list) {
            list.forEach(l => l(session.status, session.qrCode, session.lastError))
        }
    }

    public getStatus = (connectionId: string) => {
        const session = this.getSession(connectionId)
        return {
            status: session.status,
            qrCode: session.qrCode,
            lastError: session.lastError
        }
    }

    public connect = async (connectionId: string) => {
        const session = this.getSession(connectionId)

        if (session.socket || session.status === "connecting") {
            console.log(`WhatsApp Manager [${connectionId}]: Socket already exists or connecting, skipping connection`)
            return
        }

        session.status = "connecting"
        session.lastError = undefined
        this.notify(connectionId)

        try {
            const logger = pino({ level: 'silent' })
            const { state, saveCreds } = await createDrizzleAuthState(connectionId)
            const { version } = await fetchLatestBaileysVersion()

            const sock = makeWASocket({
                version,
                logger,
                printQRInTerminal: false,
                browser: ["FourthChat", "Chrome", "1.0.0"],
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                generateHighQualityLinkPreview: true,
            })

            session.socket = sock

            sock.ev.on('creds.update', saveCreds)

            sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
                const { connection, lastDisconnect, qr } = update
                const currentSession = this.getSession(connectionId)

                if (qr) {
                    currentSession.qrCode = qr
                    currentSession.status = "qr_ready"
                    currentSession.lastError = undefined
                    this.notify(connectionId)
                }

                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode !== DisconnectReason.loggedOut
                    const error = (lastDisconnect?.error as Error)?.message || "Connection closed"

                    console.log(`[${connectionId}] connection closed due to `, lastDisconnect?.error, ', reconnecting ', shouldReconnect)

                    currentSession.socket = null
                    currentSession.qrCode = null
                    currentSession.status = "disconnected"

                    this.clearQueuesForConnection(connectionId)

                    if (!shouldReconnect) {
                        currentSession.lastError = error
                    }
                    this.notify(connectionId)

                    if (shouldReconnect) {
                        const delay = 5000 // 5 seconds delay
                        console.log(`[${connectionId}] Reconnecting in ${delay}ms...`)
                        setTimeout(() => {
                            const s = this.getSession(connectionId)
                            if (s.status === "disconnected") {
                                this.connect(connectionId)
                            }
                        }, delay)
                    }
                } else if (connection === 'open') {
                    console.log(`[${connectionId}] opened connection`)
                    currentSession.qrCode = null
                    currentSession.status = "connected"
                    currentSession.lastError = undefined
                    this.notify(connectionId)
                }
            })

            sock.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify') return

                for (const msg of messages) {
                    if (!msg.key.fromMe && msg.message) {
                        const remoteJid = msg.key.remoteJid!
                        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption

                        if (text && remoteJid) {
                            const queueKey = `${connectionId}:${remoteJid}`
                            const currentQueue = this.messageQueues.get(queueKey) || Promise.resolve()

                            const nextTask = currentQueue.then(async () => {
                                try {
                                    const remoteJid = msg.key.remoteJid!

                                    const connection = await db.query.connections.findFirst({
                                        where: eq(connections.id, connectionId)
                                    })

                                    if (connection && connection.isActive) {
                                        await chatState.connect();
                                        await bot.initialize();

                                        const adapter = new BaileysAdapter({
                                            socket: session.socket!,
                                            phoneNumberId: connection.id,
                                            name: "whatsapp-native"
                                        });

                                        const threadId = adapter.encodeThreadId({
                                            phoneNumberId: connection.id,
                                            userWaId: remoteJid
                                        });

                                        const chatMessage = adapter.parseMessage({
                                            socket: session.socket!,
                                            remoteJid,
                                            message: msg
                                        });
                                        bot.processMessage(adapter, threadId, chatMessage);
                                    }
                                } catch (e) {
                                    console.error(`[${connectionId}] Error processing incoming message:`, e)
                                }
                            })

                            this.messageQueues.set(queueKey, nextTask)

                            nextTask.finally(() => {
                                if (this.messageQueues.get(queueKey) === nextTask) {
                                    this.messageQueues.delete(queueKey)
                                }
                            })
                        }
                    }
                }
            })
        } catch (error) {
            console.error(`[${connectionId}] Failed to connect:`, error)
            session.status = "disconnected"
            this.notify(connectionId)
        }
    }

    public async logout(connectionId: string) {
        const session = this.getSession(connectionId)
        if (session.socket) {
            await session.socket.logout()
            session.socket = null
            session.status = "disconnected"
            session.qrCode = null

            this.clearQueuesForConnection(connectionId)

            this.notify(connectionId)
        }
    }

    private clearQueuesForConnection(connectionId: string) {
        for (const key of this.messageQueues.keys()) {
            if (key.startsWith(`${connectionId}:`)) {
                this.messageQueues.delete(key)
            }
        }
    }

    public async connectAll() {
        const activeConnections = await db.query.connections.findMany({
            where: and(
                eq(connections.type, "whatsapp-native"),
                eq(connections.isActive, true)
            )
        });

        for (const conn of activeConnections) {
            try {
                this.connect(conn.id);
            } catch (err) {
                console.error(`[WhatsApp Manager] Failed to connect bot ${conn.id}:`, err);
            }
        }
    }
}

const globalForWhatsApp = globalThis as unknown as { whatsappManagerV3: WhatsAppManager }

const whatsappManager = globalForWhatsApp.whatsappManagerV3 || new WhatsAppManager()

if (process.env.NODE_ENV !== "production") globalForWhatsApp.whatsappManagerV3 = whatsappManager

export default whatsappManager
