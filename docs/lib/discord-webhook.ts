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

  // Browser detection patterns (order matters - Chrome must come before Safari)
  const browserPatterns = [
    { pattern: 'Edge/', name: 'Edge' },
    { pattern: 'Chrome/', name: 'Chrome' },
    { pattern: 'Firefox/', name: 'Firefox' },
    { pattern: 'Safari/', name: 'Safari' },
  ];

  // OS detection patterns
  const osPatterns = [
    { pattern: 'Windows NT', name: 'Windows' },
    { pattern: 'Mac OS X', name: 'macOS' },
    { pattern: 'iPhone', name: 'iOS' },
    { pattern: 'iPad', name: 'iOS' },
    { pattern: 'Android', name: 'Android' },
    { pattern: 'Linux', name: 'Linux' },
  ];

  // Find browser
  const browser = browserPatterns.find(({ pattern }) => userAgent.includes(pattern))?.name || 'Unknown';

  // Find OS
  const os = osPatterns.find(({ pattern }) => userAgent.includes(pattern))?.name || 'Unknown';

  return `${browser} on ${os}`;
}
