import { NextRequest, NextResponse } from 'next/server';
import { sendToDiscordWebhook } from '../../../../lib/discord-webhook';

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();

    if (!data.message || typeof data.message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Send message to Discord webhook with all metadata
    await sendToDiscordWebhook(data);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in Discord webhook API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
