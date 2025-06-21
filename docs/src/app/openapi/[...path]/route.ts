import { readFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathArray } = await params;
    const filePath = pathArray.join('/');

    // Ensure the file ends with .json for security
    if (!filePath.endsWith('.json')) {
      return new NextResponse('Not Found', { status: 404 });
    }

    // Construct the full path to the OpenAPI file
    const fullPath = path.join(process.cwd(), 'openapi', filePath);

    // Read the file
    const fileContent = await readFile(fullPath, 'utf8');

    // Return the JSON content
    return new NextResponse(fileContent, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache', // Don't cache during development
      },
    });
  } catch (error) {
    console.error('Error serving OpenAPI file:', error);
    return new NextResponse('Not Found', { status: 404 });
  }
}
