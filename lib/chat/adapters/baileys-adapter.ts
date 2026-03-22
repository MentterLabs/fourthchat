import { 
  Adapter, 
  AdapterPostableMessage, 
  ChatInstance, 
  Message, 
  RawMessage, 
  ThreadInfo, 
  FormattedContent, 
  EmojiValue, 
  FetchResult
} from 'chat';
import { WASocket, proto } from "@whiskeysockets/baileys";

export interface BaileysAdapterConfig {
  name?: string;
  socket: WASocket;
  phoneNumberId: string;
}

export interface BaileysThreadId {
  phoneNumberId: string;
  userWaId: string;
}

export interface BaileysRawMessage {
  socket: WASocket;
  remoteJid: string;
  message: proto.IWebMessageInfo;
}

export class BaileysAdapter implements Adapter<BaileysThreadId, BaileysRawMessage> {
  public readonly name: string;
  public readonly persistMessageHistory = true;
  private chat?: ChatInstance;
  private socket: WASocket;
  private phoneNumberId: string;

  constructor(config: BaileysAdapterConfig) {
    this.name = config.name || "whatsapp-native";
    this.socket = config.socket;
    this.phoneNumberId = config.phoneNumberId;
  }

  public async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
  }

  public get userName(): string {
    return this.chat?.getUserName() || "WhatsApp Bot";
  }

  public encodeThreadId(data: BaileysThreadId): string {
    return `${this.name}:${data.phoneNumberId}:${data.userWaId}`;
  }

  public decodeThreadId(threadId: string): BaileysThreadId {
    const [, phoneNumberId, userWaId] = threadId.split(':');
    return { phoneNumberId, userWaId };
  }

  public channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  public isDM(): boolean {
    return true;
  }

  public async postMessage(threadId: string, message: AdapterPostableMessage): Promise<RawMessage<BaileysRawMessage>> {
    const { userWaId } = this.decodeThreadId(threadId);
    const text = typeof message === "string" ? message : ("markdown" in message ? message.markdown : ("raw" in message ? message.raw : ""));

    const sent = await this.socket.sendMessage(userWaId, { text });
    
    return {
      id: sent?.key.id || Date.now().toString(),
      threadId,
      raw: {
        socket: this.socket,
        remoteJid: userWaId,
        message: sent as proto.IWebMessageInfo,
      },
    };
  }

  public async editMessage(): Promise<RawMessage<BaileysRawMessage>> {
    throw new Error("WhatsApp edit not supported");
  }

  public async deleteMessage(): Promise<void> {
    throw new Error("WhatsApp delete not supported");
  }

  public async addReaction(threadId: string, messageId: string, emoji: EmojiValue | string): Promise<void> {
    const { userWaId } = this.decodeThreadId(threadId);
    await this.socket.sendMessage(userWaId, {
      react: { text: emoji.toString(), key: { remoteJid: userWaId, id: messageId } },
    });
  }

  public async removeReaction(threadId: string, messageId: string): Promise<void> {
    const { userWaId } = this.decodeThreadId(threadId);
    await this.socket.sendMessage(userWaId, {
      react: { text: "", key: { remoteJid: userWaId, id: messageId } },
    });
  }

  public async startTyping(threadId: string): Promise<void> {
    const { userWaId } = this.decodeThreadId(threadId);
    await this.socket.sendPresenceUpdate("composing", userWaId);
  }

  public async fetchThread(threadId: string): Promise<ThreadInfo> {
    return { id: threadId, channelId: threadId, isDM: true, metadata: {} };
  }

  public async fetchMessages(): Promise<FetchResult<BaileysRawMessage>> {
    return { messages: [] };
  }

  public parseMessage(raw: BaileysRawMessage): Message<BaileysRawMessage> {
    const m = raw.message.message;
    const text = m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || "";

    return new Message({
      id: raw.message.key?.id || "",
      threadId: this.encodeThreadId({ phoneNumberId: this.phoneNumberId, userWaId: raw.remoteJid }),
      text,
      formatted: { type: 'root', children: [{ type: 'text', value: text }] },
      raw,
      author: {
        userId: raw.remoteJid,
        userName: raw.remoteJid.split('@')[0],
        fullName: raw.remoteJid.split('@')[0],
        isBot: false,
        isMe: raw.message.key?.fromMe || false,
      },
      metadata: {
        dateSent: new Date(((raw.message.messageTimestamp as number) * 1000) || Date.now()),
        edited: false,
      },
      attachments: [],
    });
  }

  public renderFormatted(content: FormattedContent): string {
    return content.children.map((c) => ('value' in c ? c.value : "")).join("");
  }

  public handleWebhook(): Promise<Response> {
    return Promise.resolve(new Response("OK"));
  }
}

export const createBaileysAdapter = (config: BaileysAdapterConfig) => new BaileysAdapter(config);
