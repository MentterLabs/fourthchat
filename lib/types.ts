export type ConnectionConfig =
    | WebhookConfig
    | WhatsAppBusinessConfig
    | SlackConfig
    | DiscordConfig
    | TelegramConfig;

export interface WebhookConfig {
    type: "webhook";
    webhookUrl: string;
    secret?: string;
    headers?: Record<string, string>;
}

export interface WhatsAppBusinessConfig {
    type: "whatsapp-business";
    phoneNumberId: string;
    accessToken: string;
    verifyToken: string;
    businessAccountId?: string;
}

export interface SlackConfig {
    type: "slack";
    botToken: string;
    signingSecret: string;
}

export interface DiscordConfig {
    type: "discord";
    botToken: string;
    applicationId: string;
    publicKey: string;
}

export interface TelegramConfig {
    type: "telegram";
    botToken: string;
}

export interface WebhookPayload {
    userId?: string
    message?: string
    conversationId?: string
    messageId?: string
    timestamp?: string
    metadata?: Record<string, unknown>
    [key: string]: unknown
}

export { type ApiKeyConfig, type UserSettings } from "@/lib/schema"
