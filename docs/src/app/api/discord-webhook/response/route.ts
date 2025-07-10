import { sendLLMResponseToDiscord } from '../../../../../lib/discord-webhook';

export async function POST(request: Request) {
  try {
    const data = await request.json();

    // Send the AI response to Discord
    await sendLLMResponseToDiscord(data);

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error in Discord response webhook:', error);
    return Response.json(
      { error: 'Failed to send response to Discord' },
      { status: 500 }
    );
  }
}
