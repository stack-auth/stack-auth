/**
 * Sends a message to Discord webhook with rich metadata
 */
export async function sendToDiscordWebhook(data: {
  message: string;
  username?: string;
  metadata?: {
    url?: string;
    pathname?: string;
    timestamp?: string;
    userAgent?: string;
    viewport?: string;
    isHomePage?: boolean;
    isScrolled?: boolean;
    messageLength?: number;
    messageType?: string;
    sessionMessageCount?: number;
    timeOnPage?: number;
    scrollDepth?: number;
    referrer?: string;
    language?: string;
    timezone?: string;
    chatExpanded?: boolean;
  };
}) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.warn('Discord webhook URL not configured');
    return;
  }

  try {
    const { message, username, metadata } = data;
    
    // Create a rich embed with metadata
    const embed = {
      title: "💬 AI Chat Message",
      description: message.length > 100 ? message.substring(0, 100) + "..." : message,
      color: metadata?.messageType === 'starter-prompt' ? 0x10b981 : 0x3b82f6, // Green for starter prompts, blue for custom
      fields: [
        // Message Info
        ...(metadata?.messageType ? [{ name: "📝 Type", value: metadata.messageType === 'starter-prompt' ? "Starter Prompt" : "Custom Message", inline: true }] : []),
        ...(metadata?.messageLength ? [{ name: "📏 Length", value: `${metadata.messageLength} chars`, inline: true }] : []),
        ...(metadata?.chatExpanded !== undefined ? [{ name: "🔍 Chat Mode", value: metadata.chatExpanded ? "Expanded" : "Normal", inline: true }] : []),
        
        // Page Context
        ...(metadata?.pathname ? [{ name: "📄 Page", value: metadata.pathname, inline: true }] : []),
        ...(metadata?.isHomePage !== undefined ? [{ name: "🏠 Homepage", value: metadata.isHomePage ? "Yes" : "No", inline: true }] : []),
        ...(metadata?.isScrolled !== undefined ? [{ name: "📜 Scrolled", value: metadata.isScrolled ? "Yes" : "No", inline: true }] : []),
        
        // Session Data
        ...(metadata?.sessionMessageCount ? [{ name: "💬 Session Messages", value: metadata.sessionMessageCount.toString(), inline: true }] : []),
        ...(metadata?.timeOnPage ? [{ name: "⏱️ Time on Page", value: formatTime(metadata.timeOnPage), inline: true }] : []),
        ...(metadata?.scrollDepth !== undefined ? [{ name: "📊 Scroll Depth", value: `${metadata.scrollDepth}%`, inline: true }] : []),
        
        // Technical Info
        ...(metadata?.viewport ? [{ name: "📱 Viewport", value: metadata.viewport, inline: true }] : []),
        ...(metadata?.language ? [{ name: "🌐 Language", value: metadata.language, inline: true }] : []),
        ...(metadata?.timezone ? [{ name: "⏰ Timezone", value: metadata.timezone, inline: true }] : []),
      ],
      timestamp: metadata?.timestamp || new Date().toISOString(),
      footer: {
        text: "Stack Auth Docs AI Chat",
        icon_url: "https://cdn.discordapp.com/embed/avatars/0.png"
      }
    };

    // Add full message as a separate field if it was truncated
    if (message.length > 100) {
      embed.fields.unshift({ name: "📝 Full Message", value: message, inline: false });
    }

    // Extract browser info from user agent
    const browserInfo = extractBrowserInfo(metadata?.userAgent || '');
    if (browserInfo) {
      embed.fields.push({ name: "🌐 Browser", value: browserInfo, inline: true });
    }

    // Add referrer info
    if (metadata?.referrer && metadata.referrer !== 'Direct') {
      embed.fields.push({ name: "🔗 Referrer", value: metadata.referrer, inline: true });
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: username || 'Stack Auth Docs User',
        avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      console.error('Failed to send message to Discord:', response.statusText);
    }
  } catch (error) {
    console.error('Error sending message to Discord:', error);
  }
}

/**
 * Format time in seconds to a human-readable format
 */
function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Extract browser and OS info from user agent
 */
function extractBrowserInfo(userAgent: string): string | null {
  if (!userAgent) return null;

  // Extract browser
  let browser = 'Unknown';
  if (userAgent.includes('Chrome/')) {
    browser = 'Chrome';
  } else if (userAgent.includes('Firefox/')) {
    browser = 'Firefox';
  } else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) {
    browser = 'Safari';
  } else if (userAgent.includes('Edge/')) {
    browser = 'Edge';
  }

  // Extract OS
  let os = 'Unknown';
  if (userAgent.includes('Windows NT')) {
    os = 'Windows';
  } else if (userAgent.includes('Mac OS X')) {
    os = 'macOS';
  } else if (userAgent.includes('Linux')) {
    os = 'Linux';
  } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    os = 'iOS';
  } else if (userAgent.includes('Android')) {
    os = 'Android';
  }

  return `${browser} on ${os}`;
} 
