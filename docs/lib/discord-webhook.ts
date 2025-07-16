/**
 * Discord Bot API implementation with session threading support
 */

interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  thread?: {
    id: string;
    name: string;
  };
}

interface DiscordThread {
  id: string;
  name: string;
  parent_id: string;
}

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
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  
  if (!botToken || !channelId) {
    console.warn('Discord bot token or channel ID not configured');
    return;
  }

  try {
    const { message, metadata } = data;
    
    // Format message with clean text structure
    const sessionPrefix = metadata?.sessionId ? metadata.sessionId.slice(-8) : 'unknown';
    const messageNumber = metadata?.messageNumber || 1;
    const messageType = metadata?.messageType === 'starter-prompt' ? '🟢' : '🔵';
    const timeOnPage = metadata?.timeOnPage ? formatTime(metadata.timeOnPage) : 'N/A';
    const browserInfo = extractBrowserInfo(metadata?.userAgent || '');
    const page = formatPagePath(metadata?.pathname || '/');
    
    // Check if an existing thread exists for this session
    const existingThreadId = await findExistingThread(channelId, sessionPrefix);
    
    if (existingThreadId) {
      // Send to existing thread
      await sendToThread(existingThreadId, message, {
        messageNumber,
        messageType,
        page,
        timeOnPage,
        browserInfo
      });
    } else {
      // Create new thread for first message
      await createNewThread(channelId, message, {
        sessionPrefix,
        messageNumber,
        messageType,
        page,
        timeOnPage,
        browserInfo
      });
    }
  } catch (error) {
    if (error instanceof TypeError) {
      // Network errors, CORS issues, or malformed URLs
      console.error('Network error sending message to Discord:', error.message);
    } else if (error instanceof SyntaxError) {
      // JSON parsing errors
      console.error('JSON parsing error in Discord webhook:', error.message);
    } else if (error instanceof Error) {
      // General errors with message
      console.error('Error sending message to Discord:', error.message);
    } else {
      // Unknown error types
      console.error('Unknown error sending message to Discord:', error);
    }
  }
}

export async function sendLLMResponseToDiscord(data: {
  response: string;
  metadata?: {
    sessionId?: string;
    model?: string;
  };
}) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  
  if (!botToken || !channelId) {
    console.warn('Discord bot token or channel ID not configured');
    return;
  }

  try {
    const { response, metadata } = data;
    const sessionId = metadata?.sessionId || 'unknown';
    const sessionPrefix = sessionId.slice(-8);
    
    // Find the existing thread for this session
    const existingThreadId = await findExistingThread(channelId, sessionPrefix);
    
    if (!existingThreadId) {
      console.warn(`No thread found for session ${sessionId}`);
      return;
    }

    await sendResponseToThread(existingThreadId, response, {
      model: metadata?.model
    });
  } catch (error) {
    if (error instanceof TypeError) {
      // Network errors, CORS issues, or malformed URLs
      console.error('Network error sending LLM response to Discord:', error.message);
    } else if (error instanceof SyntaxError) {
      // JSON parsing errors
      console.error('JSON parsing error in Discord LLM response:', error.message);
    } else if (error instanceof Error) {
      // General errors with message
      console.error('Error sending LLM response to Discord:', error.message);
    } else {
      // Unknown error types
      console.error('Unknown error sending LLM response to Discord:', error);
    }
  }
}

async function findExistingThread(channelId: string, sessionPrefix: string): Promise<string | null> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  
  if (!botToken) {
    return null;
  }

  try {
    // Get recent messages from the channel to find existing threads
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=50`, {
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch recent messages (${response.status}):`, errorText);
      return null;
    }

    const messages: DiscordMessage[] = await response.json();
    
    // Look for a message that contains our session prefix and has an associated thread
    for (const message of messages) {
      if (message.content.includes(`\`${sessionPrefix}\``) && message.thread) {
        console.log(`Found existing thread for session ${sessionPrefix}: ${message.thread.id}`);
        return message.thread.id;
      }
    }
    
    return null;
  } catch (error) {
    if (error instanceof TypeError) {
      // Network errors, invalid URL, or connection issues
      console.error('Network error finding existing thread:', error.message);
    } else if (error instanceof SyntaxError) {
      // JSON parsing errors from Discord API response
      console.error('JSON parsing error in Discord API response:', error.message);
    } else if (error instanceof Error) {
      // General errors with message
      console.error('Error finding existing thread:', error.message);
    } else {
      // Unknown error types
      console.error('Unknown error finding existing thread:', error);
    }
    return null;
  }
}

async function createNewThread(
  channelId: string, 
  message: string, 
  context: {
    sessionPrefix: string;
    messageNumber: number;
    messageType: string;
    page: string;
    timeOnPage: string;
    browserInfo?: string;
  }
): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  
  try {
    // Clean, readable format
    const initialMessage = `💬 ${message}

\`${context.sessionPrefix}\` ${context.messageType} • ${context.page} • Page time: ${context.timeOnPage}${context.browserInfo ? ` • ${context.browserInfo}` : ''}`;

    const messageResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: initialMessage,
      }),
    });

    if (!messageResponse.ok) {
      const errorText = await messageResponse.text();
      console.error(`Failed to send initial message (${messageResponse.status}):`, errorText);
      return;
    }

    const messageData: DiscordMessage = await messageResponse.json();

    // Create a thread from this message
    const threadName = `${context.sessionPrefix}: ${extractQuestionSummary(message)}`;
    
    const threadResponse = await fetch(`https://discord.com/api/v10/channels/${messageData.channel_id}/messages/${messageData.id}/threads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: threadName.slice(0, 100), // Discord thread names have a 100 character limit
        auto_archive_duration: 1440, // 24 hours
      }),
    });

    if (!threadResponse.ok) {
      const errorText = await threadResponse.text();
      console.error(`Failed to create thread (${threadResponse.status}):`, errorText);
      return;
    }

    const threadData: DiscordThread = await threadResponse.json();
    console.log(`Created new thread: ${threadData.name} (${threadData.id})`);
    
  } catch (error) {
    if (error instanceof TypeError) {
      // Network errors, invalid URL, or connection issues
      console.error('Network error creating new thread:', error.message);
    } else if (error instanceof SyntaxError) {
      // JSON parsing errors from Discord API response
      console.error('JSON parsing error creating thread:', error.message);
    } else if (error instanceof Error) {
      // General errors with message
      console.error('Error creating thread:', error.message);
    } else {
      // Unknown error types
      console.error('Unknown error creating thread:', error);
    }
  }
}

async function sendToThread(
  threadId: string, 
  message: string, 
  context: {
    messageNumber: number;
    messageType: string;
    page: string;
    timeOnPage: string;
    browserInfo?: string;
  }
): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  
  try {
    // Clean follow-up format
    const formattedMessage = `🔄 **${message}**

${context.messageType} • ${context.page} • Page time: ${context.timeOnPage}${context.browserInfo ? ` • ${context.browserInfo}` : ''}`;

    const response = await fetch(`https://discord.com/api/v10/channels/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: formattedMessage,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to send message to thread (${response.status}):`, errorText);
      // If thread doesn't exist anymore, log it but continue
      if (response.status === 404) {
        console.warn(`Thread ${threadId} no longer exists`);
      }
    } else {
      console.log(`Sent follow-up message to thread ${threadId}`);
    }
  } catch (error) {
    if (error instanceof TypeError) {
      // Network errors, invalid URL, or connection issues
      console.error('Network error sending message to thread:', error.message);
    } else if (error instanceof SyntaxError) {
      // JSON parsing errors
      console.error('JSON parsing error sending to thread:', error.message);
    } else if (error instanceof Error) {
      // General errors with message
      console.error('Error sending message to thread:', error.message);
    } else {
      // Unknown error types
      console.error('Unknown error sending message to thread:', error);
    }
  }
}

async function sendResponseToThread(
  threadId: string,
  response: string,
  context: {
    model?: string;
  }
): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  
  try {
    const model = context.model || 'N/A';

    // Truncate response if too long for Discord (2000 char limit)
    const truncatedResponse = response.length > 1500 ? response.slice(0, 1500) + '...' : response;

    const formattedResponse = `🤖 **AI Response**

\`\`\`
${truncatedResponse}
\`\`\`

${model}`;

    const discordResponse = await fetch(`https://discord.com/api/v10/channels/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: formattedResponse,
      }),
    });

    if (!discordResponse.ok) {
      const errorText = await discordResponse.text();
      console.error(`Failed to send response to thread (${discordResponse.status}):`, errorText);
      // If thread doesn't exist anymore, log it but continue
      if (discordResponse.status === 404) {
        console.warn(`Thread ${threadId} no longer exists for AI response`);
      }
    } else {
      console.log(`Sent AI response to thread ${threadId}`);
    }
  } catch (error) {
    if (error instanceof TypeError) {
      // Network errors, invalid URL, or connection issues
      console.error('Network error sending response to thread:', error.message);
    } else if (error instanceof SyntaxError) {
      // JSON parsing errors
      console.error('JSON parsing error sending response to thread:', error.message);
    } else if (error instanceof Error) {
      // General errors with message
      console.error('Error sending response to thread:', error.message);
    } else {
      // Unknown error types
      console.error('Unknown error sending response to thread:', error);
    }
  }
}

function extractQuestionSummary(message: string): string {
  // Extract first few words of the question for thread naming
  const words = message.split(' ').slice(0, 6).join(' ');
  return words.length > 40 ? words.slice(0, 37) + '...' : words;
}

function formatPagePath(pathname: string): string {
  // Simplify common paths for better readability
  if (pathname === '/') return 'Home';
  if (pathname.startsWith('/docs/')) {
    const path = pathname.replace('/docs/', '');
    if (path === '') return 'Docs';
    // Show only the last part of the path for brevity
    const parts = path.split('/');
    return parts[parts.length - 1] || 'Docs';
  }
  return pathname.length > 20 ? '...' + pathname.slice(-17) : pathname;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

/**
 * Extract browser and OS info from user agent
 */
function extractBrowserInfo(userAgent: string): string | undefined {
  if (!userAgent) return undefined;

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
