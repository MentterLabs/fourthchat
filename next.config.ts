import type { NextConfig } from "next";

const nextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  serverExternalPackages: [
    "keyv",
    "pdf-parse",
    "mammoth",
    "xlsx",
    "@cacheable/utils",
    "@cacheable/memory",
    "cacheable",
    "pino",
    "thread-stream",
    "discord.js",
    "@discordjs/ws",
    "@chat-adapter/discord",
    "@chat-adapter/shared",
    "@chat-adapter/telegram",
    "@whiskeysockets/baileys"
  ],
} as NextConfig;


export default nextConfig;
