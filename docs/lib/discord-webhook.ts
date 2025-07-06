/**
 * Sends a message to Discord webhook with session tracking
 */
export async function sendToDiscordWebhook(data: {
  message: string;
  username?: string;
  metadata?: {
    sessionId?: string;
    messageNumber?: number;
    pathname?: string;
    timestamp?: string;
    userAgent?: string;
    messageType?: string;
    timeOnPage?: number;
    isFollowUp?: boolean;
  };
}) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.warn('Discord webhook URL not configured');
    return;
  }

  try {
    const { message, username, metadata } = data;
    
    // Format message with clean text structure
    const sessionPrefix = metadata?.sessionId ? metadata.sessionId.slice(-8) : 'unknown';
    const messageNumber = metadata?.messageNumber || 1;
    const isFollowUp = metadata?.isFollowUp || false;
    const messageType = metadata?.messageType === 'starter-prompt' ? '🟢 Starter' : '🔵 Custom';
    const timeOnPage = metadata?.timeOnPage ? formatTime(metadata.timeOnPage) : 'N/A';
    const browserInfo = extractBrowserInfo(metadata?.userAgent || '');
    const page = metadata?.pathname || 'Unknown';
    
    // Create formatted message
    const formattedMessage = `${isFollowUp ? '🔄 **FOLLOW-UP**' : '💬 **NEW CONVERSATION**'} 
**Session:** \`${sessionPrefix}\` **|** **Message #${messageNumber}** **|** ${messageType}

**Question:**
> ${message}

**Context:**
📄 **Page:** ${page}
⏱️ **Time on Page:** ${timeOnPage}${browserInfo ? `\n🌐 **Browser:** ${browserInfo}` : ''}

---`;

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: formattedMessage,
        username: username || 'Stack Auth Docs User',
        avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
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
