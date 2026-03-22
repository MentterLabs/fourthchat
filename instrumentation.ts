export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { default: discordManager } = await import("./lib/discord/manager");
    const { default: whatsappManager } = await import("./lib/whatsapp/manager");

    await Promise.allSettled([
      discordManager.connectAll(),
      whatsappManager.connectAll()
    ]);
  }
}
