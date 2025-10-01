'use client';

import { PlatformCodeblock } from './platform-codeblock';

// Demo component to test multi-instance synchronization
export function PlatformCodeblockSyncDemo() {
  const samplePlatforms = {
    "Python": {
      "Django": {
        code: `# Django Authentication
from django.contrib.auth import authenticate, login
from django.http import JsonResponse

def login_view(request):
    user = authenticate(username='user', password='pass')
    if user:
        login(request, user)
        return JsonResponse({'success': True})`,
        language: "python",
        filename: "views.py"
      },
      "FastAPI": {
        code: `# FastAPI Authentication
from fastapi import FastAPI, HTTPException

app = FastAPI()

@app.post("/login")
async def login():
    # Authentication logic here
    return {"access_token": "token", "token_type": "bearer"}`,
        language: "python",
        filename: "main.py"
      }
    },
    "JavaScript": {
      "Next.js": {
        code: `// Next.js API Route
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();
  
  // Authentication logic here
  return NextResponse.json({ success: true });
}`,
        language: "typescript",
        filename: "app/api/login/route.ts"
      },
      "Express": {
        code: `// Express.js Route
const express = require('express');
const app = express();

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  // Authentication logic here
  res.json({ success: true });
});`,
        language: "javascript",
        filename: "server.js"
      }
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-4">First Instance</h3>
        <PlatformCodeblock
          title="Login Implementation"
          platforms={samplePlatforms}
          defaultPlatform="Python"
        />
      </div>
      
      <div>
        <h3 className="text-lg font-semibold mb-4">Second Instance</h3>
        <PlatformCodeblock
          title="Authentication Setup"
          platforms={samplePlatforms}
          defaultPlatform="JavaScript"
        />
      </div>
      
      <div className="text-sm text-fd-muted-foreground space-y-2">
        <p>
          <strong>Test Single Cascading Dropdown:</strong> Click "Change" to open the dropdown, select a platform, then select a framework within that platform!
        </p>
        <p>
          <strong>Navigation:</strong> Use the "Back" button to return to platform selection from framework selection!
        </p>
        <p>
          <strong>Cross-Instance Sync:</strong> Change selections in one instance and watch both instances update simultaneously!
        </p>
        <p>
          <strong>Persistence:</strong> Refresh the page and your selections will be remembered across sessions!
        </p>
      </div>
    </div>
  );
}
