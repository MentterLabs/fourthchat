import { Pool } from 'pg';
import { Chat } from "chat";
import { createPostgresState } from "@chat-adapter/state-pg";
import { registerHandlers } from "./handlers";

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL!,
});

export const state = createPostgresState({
  client: pool,
  keyPrefix: "fourthchat-sdk",
});

const botConfig = {
  userName: "FourthChat Bot",
  state,
  adapters: {},
  dedupeTtlMs: 600_000,
};

const globalForChat = globalThis as unknown as { bot: Chat };

export const bot = globalForChat.bot || new Chat(botConfig).registerSingleton();

if (!globalForChat.bot) {
  registerHandlers(bot);
}

if (process.env.NODE_ENV !== "production") globalForChat.bot = bot;

export default bot;
