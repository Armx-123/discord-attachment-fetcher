export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Environment Variables
    const BOT_TOKEN = env.DISCORD_TOKEN;
    const SOURCE_CHANNEL_ID = env.DISCORD_CHANNEL_ID;
    const TARGET_CHANNEL_ID = env.TARGET_CHANNEL_ID; // Required for the /delete endpoint

    if (!BOT_TOKEN || !SOURCE_CHANNEL_ID || !TARGET_CHANNEL_ID) {
      return Response.json({ error: "Missing required environment variables (DISCORD_TOKEN, DISCORD_CHANNEL_ID, or TARGET_CHANNEL_ID)." }, { status: 500 });
    }

    const headers = {
      "Authorization": `Bot ${BOT_TOKEN}`,
      "User-Agent": "DiscordBot (https://cloudflare.com, 1.0)",
    };

    // Helper Function: Fetch messages
    async function getMessages(channelId, limit) {
      const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`, { headers });
      if (!res.ok) throw new Error(`Discord API Error: ${res.status}`);
      return await res.json();
    }

    try {
      // API ROUTER
      switch (url.pathname) {
        
        // 1. GET_MESSAGE
        case '/get_message': {
          const msgs = await getMessages(SOURCE_CHANNEL_ID, 1);
          if (msgs.length === 0) return Response.json({ error: "No messages found." }, { status: 404 });
          
          return Response.json({
            messageId: msgs[0].id,
            attachment: msgs[0].attachments.length > 0 ? msgs[0].attachments[0] : null
          });
        }

        // 2. DELETE (Moves the attachment, then deletes original)
        case '/delete': {
          const msgId = url.searchParams.get('message_id');
          if (!msgId) return Response.json({ error: "Missing ?message_id parameter" }, { status: 400 });

          // A. Fetch original message details
          const msgRes = await fetch(`https://discord.com/api/v10/channels/${SOURCE_CHANNEL_ID}/messages/${msgId}`, { headers });
          if (!msgRes.ok) return Response.json({ error: "Message not found" }, { status: 404 });
          const msg = await msgRes.json();

          // B. If it has an attachment, upload it to the TARGET_CHANNEL
          if (msg.attachments && msg.attachments.length > 0) {
            const att = msg.attachments[0];

            // Safety Constraint: Prevent Worker OOM crash (Max 50MB)
            if (att.size > 50 * 1024 * 1024) {
              return Response.json({ error: "Attachment exceeds Worker memory safety limit (50MB)." }, { status: 413 });
            }

            const fileRes = await fetch(att.url);
            const fileBlob = await fileRes.blob();
            
            const formData = new FormData();
            formData.append('files[0]', fileBlob, att.filename);

            const postRes = await fetch(`https://discord.com/api/v10/channels/${TARGET_CHANNEL_ID}/messages`, {
              method: "POST",
              headers: { "Authorization": `Bot ${BOT_TOKEN}` }, // Note: No Content-Type; FormData sets boundaries automatically
              body: formData
            });

            if (!postRes.ok) throw new Error("Failed to post attachment to the new channel.");
          }

          // C. Delete original message
          const delRes = await fetch(`https://discord.com/api/v10/channels/${SOURCE_CHANNEL_ID}/messages/${msgId}`, {
            method: "DELETE",
            headers
          });

          if (!delRes.ok) throw new Error("Failed to delete the original message.");
          return Response.json({ success: true, status: "Message successfully moved and deleted." });
        }

        // 3. COUNT
        case '/count': {
          const channelId = url.searchParams.get('channel_id');
          if (!channelId) return Response.json({ error: "Missing ?channel_id parameter" }, { status: 400 });
          
          const msgs = await getMessages(channelId, 20);
          return Response.json({ count: msgs.length });
        }

        // 4. GET_ALL
        case '/get_all': {
          const msgs = await getMessages(SOURCE_CHANNEL_ID, 20);
          const formatted = msgs.map(m => ({
            messageId: m.id,
            attachment: m.attachments.length > 0 ? m.attachments[0] : null
          }));
          return Response.json({ messages: formatted });
        }

        // 5. CLEAR_ALL
        case '/clear_all': {
          const msgs = await getMessages(SOURCE_CHANNEL_ID, 20);
          if (msgs.length === 0) return Response.json({ success: true, deleted: 0 });

          const msgIds = msgs.map(m => m.id);

          // Safety Constraint: Bulk delete fails if there is only 1 message
          if (msgIds.length === 1) {
            await fetch(`https://discord.com/api/v10/channels/${SOURCE_CHANNEL_ID}/messages/${msgIds[0]}`, {
              method: "DELETE",
              headers
            });
          } else {
            const bulkRes = await fetch(`https://discord.com/api/v10/channels/${SOURCE_CHANNEL_ID}/messages/bulk-delete`, {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify({ messages: msgIds })
            });
            if (!bulkRes.ok) throw new Error("Bulk deletion failed.");
          }

          return Response.json({ success: true, deleted: msgIds.length });
        }

        default:
          return Response.json({ error: "Invalid endpoint. Available routes: /get_message, /delete, /count, /get_all, /clear_all" }, { status: 404 });
      }

    } catch (error) {
      return Response.json({ error: `Worker Error: ${error.message}` }, { status: 500 });
    }
  }
};
