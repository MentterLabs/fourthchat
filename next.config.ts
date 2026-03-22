import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "keyv",
    "pdf-parse",
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
};

export default nextConfig;
