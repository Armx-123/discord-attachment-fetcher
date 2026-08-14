export default {
  async fetch(request, env, ctx) {
    // Retrieve credentials from Cloudflare environment variables
    const BOT_TOKEN = env.DISCORD_TOKEN; 
    const CHANNEL_ID = env.DISCORD_CHANNEL_ID;

    if (!BOT_TOKEN || !CHANNEL_ID) {
      return new Response("Missing DISCORD_TOKEN or DISCORD_CHANNEL_ID in environment.", { status: 500 });
    }

    // Discord API v10 endpoint to get the most recent message (limit=1)
    const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=1`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bot ${BOT_TOKEN}`,
          // Discord strictly requires a valid User-Agent for Bot API requests
          "User-Agent": "DiscordBot (https://cloudflare.com, 1.0)", 
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        return new Response(`Discord API returned an error: ${response.status} ${response.statusText}`, { status: response.status });
      }

      const messages = await response.json();

      // Handle the case where the channel is completely empty
      if (messages.length === 0) {
        return Response.json({ error: "No messages found in the channel." }, { status: 404 });
      }

      const latestMessage = messages[0];
      const messageId = latestMessage.id;
      
      // Check if the latest message actually contains an attachment
      if (!latestMessage.attachments || latestMessage.attachments.length === 0) {
         return Response.json({ 
          messageId: messageId, 
          attachmentUrl: null,
          note: "The latest message does not contain any attachments." 
        });
      }

      // Extract the URL of the first attachment
      const attachmentUrl = latestMessage.attachments[0].url;

      // Return the payload
      return Response.json({
        messageId: messageId,
        attachmentUrl: attachmentUrl
      });

    } catch (error) {
      return new Response(`Worker Error: ${error.message}`, { status: 500 });
    }
  }
};
