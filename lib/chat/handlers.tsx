/** @jsxImportSource chat */
import { db } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { agentService } from "@/lib/agent/service";
import { WelcomeCard } from "@/components/chat/WelcomeCard";
import { conversations, messages, connections, chatbots } from "@/lib/schema";
import { Chat, Thread, Message } from "chat";

export function registerHandlers(bot: Chat) {
  async function handleMessage(thread: Thread, message: Message) {
    try {
      const parts = thread.id.split(':');
      let connectionId = parts[1];

      if (parts[0] === 'slack' && parts.length >= 3 && !parts[2]) {
        (thread as unknown as { id: string }).id = `${parts[0]}:${parts[1]}:${message.id}`;
        connectionId = parts[1];
      }

      let connection = await db.query.connections.findFirst({
        where: and(
          eq(connections.id, connectionId),
          eq(connections.isActive, true)
        ),
      });

      if (!connection && thread.id.startsWith("slack:")) {
        const threadObj = thread as unknown as { adapter?: { botUserId?: string }, channel?: { adapter?: { botUserId?: string } } };
        const botUserId = threadObj.adapter?.botUserId || threadObj.channel?.adapter?.botUserId;

        if (botUserId) {
          const allSlackConnections = await db.query.connections.findMany({
            where: and(
              eq(connections.type, "slack"),
              eq(connections.isActive, true)
            )
          });

          connection = allSlackConnections.find(conn => {
            const cfg = conn.config as Record<string, unknown>;
            return cfg?.botUserId === botUserId;
          });
        }
      }

      if (!connection && thread.id.startsWith("discord:")) {
        const threadObj = thread as unknown as { adapter?: { botUserId?: string }, channel?: { adapter?: { botUserId?: string } } };
        const botUserId = threadObj.adapter?.botUserId || threadObj.channel?.adapter?.botUserId;

        if (botUserId) {
          const allDiscordConnections = await db.query.connections.findMany({
            where: and(
              eq(connections.type, "discord"),
              eq(connections.isActive, true)
            )
          });

          connection = allDiscordConnections.find(conn => {
            const cfg = conn.config as Record<string, unknown>;
            return cfg?.applicationId === botUserId;
          });
        }
      }

      if (!connection && thread.id.startsWith("telegram")) {
        const allTelegramConnections = await db.query.connections.findMany({
          where: and(
            eq(connections.type, "telegram"),
            eq(connections.isActive, true)
          )
        });

        if (allTelegramConnections.length === 1) {
          connection = allTelegramConnections[0];
        } else {
          const threadObj = thread as unknown as { adapter?: { botUserId?: string } };
          const botUserId = threadObj.adapter?.botUserId;

          if (botUserId) {
            connection = allTelegramConnections.find(conn => {
              const cfg = conn.config as Record<string, unknown>;
              return cfg?.botUserId === botUserId;
            });
          }
        }
      }

      if (!connection) {
        console.error(`No connection: ${connectionId}`);
        return;
      }

      const { chatbotId } = connection;

      let conversation = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.chatbotId, chatbotId),
          eq(conversations.externalUserId, message.author.userId)
        )
      });

      if (!conversation) {
        const results = await db.insert(conversations).values({
          chatbotId,
          externalUserId: message.author.userId
        }).returning();
        conversation = results[0];

        const chatbot = await db.query.chatbots.findFirst({
          where: eq(chatbots.id, chatbotId)
        });

        const userName = message.author.fullName || message.author.userName || "Valued User";
        const chatbotName = chatbot?.name || "FourthChat Bot";

        // Certain platforms (Telegram, WhatsApp) prefer plain text for greetings
        const isTextOnlyPlatform = thread.id.startsWith("telegram") || 
                                  thread.id.startsWith("whatsapp") || 
                                  thread.id.startsWith("whatsapp-native");

        if (isTextOnlyPlatform) {
          await thread.post(`Welcome to ${chatbotName}!\n\nHi ${userName}! I'm here to help you get the most out of FourthChat. Feel free to ask me anything about this business!`);
        } else {
          await thread.post(
            <WelcomeCard
              userName={userName}
              chatbotName={chatbotName}
            />
          );
        }
      }

      await db.insert(messages).values({
        conversationId: conversation.id,
        role: "user",
        content: message.text
      });

      const agent = await agentService.getAgent(chatbotId);
      if (!agent) return;

      await thread.startTyping();

      const { stream, text: responseText } = await agent.stream(message.text, conversation.id);

      // Don't stream to WhatsApp (poor UX with notifications + requires editMessage support)
      const isWhatsApp = thread.id.startsWith("whatsapp") || thread.id.startsWith("whatsapp-native");

      if (stream && !isWhatsApp) {
        await thread.post(stream);
      } else {
        await thread.post(responseText);
      }

      await db.insert(messages).values({
        conversationId: conversation.id,
        role: "assistant",
        content: responseText,
      });

    } catch (error: unknown) {
      const err = error as { code?: string; data?: unknown };
      console.error("[Handlers] ERROR in handleMessage:", err);

      if (err.code === 'slack_webapi_platform_error' && err.data) {
        console.error("[Handlers] Slack Error Data:", JSON.stringify(err.data, null, 2));
      }
      await thread.post("I encountered an error. Please try again.").catch(() => { });
    }
  };

  bot.onSubscribedMessage(async (thread, message) => {
    await handleMessage(thread, message);
  });

  bot.onDirectMessage(async (thread, message) => {
    await thread.subscribe();
    await handleMessage(thread, message);
  });

  bot.onNewMention(async (thread, message) => {
    await thread.subscribe();
    if (message) {
      await handleMessage(thread, message);
    } else {
      await thread.post("Hello! I'm your AI assistant. Mention me with a question to get started!");
    }
  });

  bot.onSlashCommand("/chat", async (event) => {
    const mockMessage: Message = {
      id: `slash:${Date.now()}`,
      text: event.text,
      author: event.user,
      metadata: { dateSent: new Date() },
      links: [],
      attachments: [],
      raw: event.raw
    } as unknown as Message;

    await handleMessage(event.channel as unknown as Thread, mockMessage);
  });

  bot.onAction("help", async (event) => {
    if (event.thread) {
      await event.thread.post("I am an AI assistant powered by FourthChat. You can ask me anything about this business!");
    }
  });

  bot.onAction("settings", async (event) => {
    if (event.thread) {
      await event.thread.post("To manage your settings, please visit the FourthChat dashboard.");
    }
  });
}
