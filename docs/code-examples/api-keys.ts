import { CodeExample } from '../lib/code-examples';

export const apiKeysExamples = {
  'api-keys': {
    'create-user-api-key': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `"use client";
import { useUser } from "@stackframe/stack";

export default function CreateApiKey() {
  const user = useUser({ or: 'redirect' });

  const handleCreateKey = async () => {
    const apiKey = await user.createApiKey({
      description: "My client application",
      expiresAt: new Date(Date.now() + (90 * 24 * 60 * 60 * 1000)), // 90 days
    });
    
    console.log("API Key created:", apiKey.value);
  };

  return <button onClick={handleCreateKey}>Create API Key</button>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/create-api-key.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

export default async function CreateApiKey() {
  const user = await stackServerApp.getUser({ or: 'redirect' });
  
  const apiKey = await user.createApiKey({
    description: "Admin-provisioned API key",
    expiresAt: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)), // 30 days
  });
  
  return <div>API Key: {apiKey.value}</div>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/create-api-key.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `"use client";
import { useUser } from "@stackframe/react";

export default function CreateApiKey() {
  const user = useUser({ or: 'redirect' });

  const handleCreateKey = async () => {
    const apiKey = await user.createApiKey({
      description: "My client application",
      expiresAt: new Date(Date.now() + (90 * 24 * 60 * 60 * 1000)), // 90 days
    });
    
    console.log("API Key created:", apiKey.value);
  };

  return <button onClick={handleCreateKey}>Create API Key</button>;
}`,
        highlightLanguage: 'typescript',
        filename: 'components/CreateApiKey.tsx'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import requests
from django.http import JsonResponse

def create_user_api_key(request):
    # Get the current user's access token from session/cookie
    access_token = request.COOKIES.get('stack-access-token')
    
    # Create API key via client API
    response = requests.post(
        'https://api.stack-auth.com/api/v1/user-api-keys',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        },
        json={
            'user_id': 'me',
            'description': 'My client application',
            'expires_at_millis': int((time.time() + 90 * 24 * 60 * 60) * 1000),
        }
    )
    
    if response.status_code != 200:
        raise Exception(f"Failed to create API key: {response.text}")
    
    return JsonResponse(response.json())`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `import requests
import time
from fastapi import Cookie, HTTPException

@app.post("/api/create-user-api-key")
async def create_user_api_key(stack_access_token: str = Cookie(None, alias="stack-access-token")):
    if not stack_access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Create API key via client API
    response = requests.post(
        'https://api.stack-auth.com/api/v1/user-api-keys',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': stack_access_token,
        },
        json={
            'user_id': 'me',
            'description': 'My client application',
            'expires_at_millis': int((time.time() + 90 * 24 * 60 * 60) * 1000),
        }
    )
    
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    
    return response.json()`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests
import time
from flask import request, jsonify

@app.route('/api/create-user-api-key', methods=['POST'])
def create_user_api_key():
    access_token = request.cookies.get('stack-access-token')
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Create API key via client API
    response = requests.post(
        'https://api.stack-auth.com/api/v1/user-api-keys',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        },
        json={
            'user_id': 'me',
            'description': 'My client application',
            'expires_at_millis': int((time.time() + 90 * 24 * 60 * 60) * 1000),
        }
    )
    
    if response.status_code != 200:
        return jsonify({'error': response.text}), response.status_code
    
    return jsonify(response.json())`,
        highlightLanguage: 'python',
        filename: 'app.py'
      },
    ] as CodeExample[],

    'create-team-api-key': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `"use client";
import { useUser } from "@stackframe/stack";

export default function CreateTeamApiKey({ teamId }: { teamId: string }) {
  const user = useUser({ or: 'redirect' });
  const team = user.useTeam(teamId);

  const handleCreateKey = async () => {
    if (!team) return;
    
    const teamApiKey = await team.createApiKey({
      description: "Team integration service",
      expiresAt: new Date(Date.now() + (60 * 24 * 60 * 60 * 1000)), // 60 days
    });
    
    console.log("Team API Key created:", teamApiKey.value);
  };

  return <button onClick={handleCreateKey}>Create Team API Key</button>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/create-team-api-key.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

export default async function CreateTeamApiKey({ teamId }: { teamId: string }) {
  const team = await stackServerApp.getTeam(teamId);
  
  if (!team) {
    return <div>Team not found</div>;
  }
  
  const teamApiKey = await team.createApiKey({
    description: "Admin-provisioned team API key",
    expiresAt: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)), // 30 days
  });
  
  return <div>Team API Key: {teamApiKey.value}</div>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/create-team-api-key.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `"use client";
import { useUser } from "@stackframe/react";

export default function CreateTeamApiKey({ teamId }: { teamId: string }) {
  const user = useUser({ or: 'redirect' });
  const team = user.useTeam(teamId);

  const handleCreateKey = async () => {
    if (!team) return;
    
    const teamApiKey = await team.createApiKey({
      description: "Team integration service",
      expiresAt: new Date(Date.now() + (60 * 24 * 60 * 60 * 1000)), // 60 days
    });
    
    console.log("Team API Key created:", teamApiKey.value);
  };

  return <button onClick={handleCreateKey}>Create Team API Key</button>;
}`,
        highlightLanguage: 'typescript',
        filename: 'components/CreateTeamApiKey.tsx'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import requests
import time
from django.http import JsonResponse

def create_team_api_key(request, team_id):
    # Get the current user's access token from session/cookie
    access_token = request.COOKIES.get('stack-access-token')
    
    # Create team API key via client API
    response = requests.post(
        'https://api.stack-auth.com/api/v1/team-api-keys',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        },
        json={
            'team_id': team_id,
            'description': 'Team integration service',
            'expires_at_millis': int((time.time() + 60 * 24 * 60 * 60) * 1000),
        }
    )
    
    if response.status_code != 200:
        raise Exception(f"Failed to create team API key: {response.text}")
    
    return JsonResponse(response.json())`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `import requests
import time
from fastapi import Cookie, HTTPException

@app.post("/api/teams/{team_id}/api-keys")
async def create_team_api_key(team_id: str, stack_access_token: str = Cookie(None, alias="stack-access-token")):
    if not stack_access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Create team API key via client API
    response = requests.post(
        'https://api.stack-auth.com/api/v1/team-api-keys',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': stack_access_token,
        },
        json={
            'team_id': team_id,
            'description': 'Team integration service',
            'expires_at_millis': int((time.time() + 60 * 24 * 60 * 60) * 1000),
        }
    )
    
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    
    return response.json()`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests
import time
from flask import request, jsonify

@app.route('/api/teams/<team_id>/api-keys', methods=['POST'])
def create_team_api_key(team_id):
    access_token = request.cookies.get('stack-access-token')
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Create team API key via client API
    response = requests.post(
        'https://api.stack-auth.com/api/v1/team-api-keys',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        },
        json={
            'team_id': team_id,
            'description': 'Team integration service',
            'expires_at_millis': int((time.time() + 60 * 24 * 60 * 60) * 1000),
        }
    )
    
    if response.status_code != 200:
        return jsonify({'error': response.text}), response.status_code
    
    return jsonify(response.json())`,
        highlightLanguage: 'python',
        filename: 'app.py'
      },
    ] as CodeExample[],

    'list-api-keys': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `"use client";
import { useUser } from "@stackframe/stack";

export default function ApiKeysList() {
  const user = useUser({ or: 'redirect' });
  const apiKeys = user.useApiKeys();

  return (
    <div>
      <h2>Your API Keys</h2>
      {apiKeys.map(key => (
        <div key={key.id}>
          <p>{key.description}</p>
          <p>Last 4 digits: {key.value.lastFour}</p>
          <p>Created: {key.createdAt.toLocaleDateString()}</p>
        </div>
      ))}
    </div>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/api-keys-list.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

export default async function ApiKeysList() {
  const user = await stackServerApp.getUser({ or: 'redirect' });
  const apiKeys = await user.listApiKeys();

  return (
    <div>
      <h2>Your API Keys</h2>
      {apiKeys.map(key => (
        <div key={key.id}>
          <p>{key.description}</p>
          <p>Last 4 digits: {key.value.lastFour}</p>
          <p>Created: {key.createdAt.toLocaleDateString()}</p>
        </div>
      ))}
    </div>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/api-keys-list.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `"use client";
import { useUser } from "@stackframe/react";

export default function ApiKeysList() {
  const user = useUser({ or: 'redirect' });
  const apiKeys = user.useApiKeys();

  return (
    <div>
      <h2>Your API Keys</h2>
      {apiKeys.map(key => (
        <div key={key.id}>
          <p>{key.description}</p>
          <p>Last 4 digits: {key.value.lastFour}</p>
          <p>Created: {key.createdAt.toLocaleDateString()}</p>
        </div>
      ))}
    </div>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'components/ApiKeysList.tsx'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import requests
from django.http import JsonResponse

def list_user_api_keys(request):
    # Get the current user's access token from session/cookie
    access_token = request.COOKIES.get('stack-access-token')
    
    # List user's API keys via client API
    response = requests.get(
        'https://api.stack-auth.com/api/v1/user-api-keys?user_id=me',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        }
    )
    
    if response.status_code != 200:
        raise Exception(f"Failed to list API keys: {response.text}")
    
    return JsonResponse(response.json(), safe=False)`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `import requests
from fastapi import Cookie, HTTPException

@app.get("/api/user-api-keys")
async def list_user_api_keys(stack_access_token: str = Cookie(None, alias="stack-access-token")):
    if not stack_access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # List user's API keys via client API
    response = requests.get(
        'https://api.stack-auth.com/api/v1/user-api-keys?user_id=me',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': stack_access_token,
        }
    )
    
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    
    return response.json()`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests
from flask import request, jsonify

@app.route('/api/user-api-keys', methods=['GET'])
def list_user_api_keys():
    access_token = request.cookies.get('stack-access-token')
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # List user's API keys via client API
    response = requests.get(
        'https://api.stack-auth.com/api/v1/user-api-keys?user_id=me',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        }
    )
    
    if response.status_code != 200:
        return jsonify({'error': response.text}), response.status_code
    
    return jsonify(response.json())`,
        highlightLanguage: 'python',
        filename: 'app.py'
      },
    ] as CodeExample[],

    'revoke-api-key': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `"use client";
import { useUser } from "@stackframe/stack";

export default function RevokeApiKey({ apiKeyId }: { apiKeyId: string }) {
  const user = useUser({ or: 'redirect' });
  const apiKeys = user.useApiKeys();

  const handleRevoke = async () => {
    const apiKeyToRevoke = apiKeys.find(key => key.id === apiKeyId);
    
    if (apiKeyToRevoke) {
      await apiKeyToRevoke.revoke();
      console.log("API Key revoked");
    }
  };

  return <button onClick={handleRevoke}>Revoke API Key</button>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/revoke-api-key.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

export async function revokeApiKey(userId: string, apiKeyId: string) {
  const user = await stackServerApp.getUser(userId);
  if (!user) return;
  
  const apiKeys = await user.listApiKeys();
  const apiKeyToRevoke = apiKeys.find(key => key.id === apiKeyId);
  
  if (apiKeyToRevoke) {
    await apiKeyToRevoke.revoke();
  }
}`,
        highlightLanguage: 'typescript',
        filename: 'lib/api-keys.ts'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `"use client";
import { useUser } from "@stackframe/react";

export default function RevokeApiKey({ apiKeyId }: { apiKeyId: string }) {
  const user = useUser({ or: 'redirect' });
  const apiKeys = user.useApiKeys();

  const handleRevoke = async () => {
    const apiKeyToRevoke = apiKeys.find(key => key.id === apiKeyId);
    
    if (apiKeyToRevoke) {
      await apiKeyToRevoke.revoke();
      console.log("API Key revoked");
    }
  };

  return <button onClick={handleRevoke}>Revoke API Key</button>;
}`,
        highlightLanguage: 'typescript',
        filename: 'components/RevokeApiKey.tsx'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import requests
from django.http import JsonResponse

def revoke_api_key(request, api_key_id):
    # Get the current user's access token from session/cookie
    access_token = request.COOKIES.get('stack-access-token')
    
    # Revoke API key via client API (update with revoked: true)
    response = requests.patch(
        f'https://api.stack-auth.com/api/v1/user-api-keys/{api_key_id}',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        },
        json={
            'revoked': True,
        }
    )
    
    if response.status_code != 200:
        raise Exception(f"Failed to revoke API key: {response.text}")
    
    return JsonResponse({'message': 'API key revoked successfully'})`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `import requests
from fastapi import Cookie, HTTPException

@app.delete("/api/user-api-keys/{api_key_id}")
async def revoke_api_key(api_key_id: str, stack_access_token: str = Cookie(None, alias="stack-access-token")):
    if not stack_access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Revoke API key via client API (update with revoked: true)
    response = requests.patch(
        f'https://api.stack-auth.com/api/v1/user-api-keys/{api_key_id}',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': stack_access_token,
        },
        json={
            'revoked': True,
        }
    )
    
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    
    return {"message": "API key revoked successfully"}`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests
from flask import request, jsonify

@app.route('/api/user-api-keys/<api_key_id>', methods=['DELETE'])
def revoke_api_key(api_key_id):
    access_token = request.cookies.get('stack-access-token')
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Revoke API key via client API (update with revoked: true)
    response = requests.patch(
        f'https://api.stack-auth.com/api/v1/user-api-keys/{api_key_id}',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        },
        json={
            'revoked': True,
        }
    )
    
    if response.status_code != 200:
        return jsonify({'error': response.text}), response.status_code
    
    return jsonify({'message': 'API key revoked successfully'})`,
        highlightLanguage: 'python',
        filename: 'app.py'
      },
    ] as CodeExample[],

    'validate-user-api-key': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `import { stackServerApp } from "@/stack/server";

export async function GET(request: Request) {
  // Extract the API key from the request headers
  const apiKey = request.headers.get('X-Stack-Api-Key');
  
  if (!apiKey) {
    return Response.json({ error: 'API key required' }, { status: 401 });
  }
  
  // Validate the API key and get the associated user
  const user = await stackServerApp.getUser({ apiKey });
  
  if (!user) {
    return Response.json({ error: 'Invalid API key' }, { status: 401 });
  }
  
  // Process the request with the authenticated user
  const data = {
    userId: user.id,
    email: user.primaryEmail,
    // Your API logic here
  };
  
  return Response.json(data);
}`,
        highlightLanguage: 'typescript',
        filename: 'app/api/protected/route.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        code: `import { StackServerApp } from "@stackframe/js";

const stackServerApp = new StackServerApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});

app.get('/api/protected', async (req, res) => {
  const apiKey = req.headers['x-stack-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  const user = await stackServerApp.getUser({ apiKey });
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  res.json({
    userId: user.id,
    email: user.primaryEmail,
  });
});`,
        highlightLanguage: 'javascript',
        filename: 'server.js'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        code: `import { StackServerApp } from "@stackframe/js";

const stackServerApp = new StackServerApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});

async function validateApiKey(apiKey) {
  const user = await stackServerApp.getUser({ apiKey });
  
  if (!user) {
    throw new Error('Invalid API key');
  }
  
  return user;
}`,
        highlightLanguage: 'javascript',
        filename: 'lib/auth.js'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import requests
from django.http import JsonResponse

def protected_view(request):
    api_key = request.headers.get('X-Stack-Api-Key')
    
    if not api_key:
        return JsonResponse({'error': 'API key required'}, status=401)
    
    # Validate API key with Stack Auth server API
    response = requests.post(
        'https://api.stack-auth.com/api/v1/user-api-keys/check',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        json={
            'api_key': api_key,
        }
    )
    
    if response.status_code != 200:
        return JsonResponse({'error': 'Invalid API key'}, status=401)
    
    api_key_data = response.json()
    return JsonResponse({'userId': api_key_data['user_id']})`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `import requests
from fastapi import FastAPI, Header, HTTPException

app = FastAPI()

@app.get("/api/protected")
async def protected_route(x_stack_api_key: str = Header(None)):
    if not x_stack_api_key:
        raise HTTPException(status_code=401, detail="API key required")
    
    # Validate API key with Stack Auth server API
    response = requests.post(
        'https://api.stack-auth.com/api/v1/user-api-keys/check',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        json={
            'api_key': x_stack_api_key,
        }
    )
    
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    api_key_data = response.json()
    return {"userId": api_key_data['user_id']}`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/api/protected')
def protected_route():
    api_key = request.headers.get('X-Stack-Api-Key')
    
    if not api_key:
        return jsonify({'error': 'API key required'}), 401
    
    # Validate API key with Stack Auth server API
    response = requests.post(
        'https://api.stack-auth.com/api/v1/user-api-keys/check',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        json={
            'api_key': api_key,
        }
    )
    
    if response.status_code != 200:
        return jsonify({'error': 'Invalid API key'}), 401
    
    api_key_data = response.json()
    return jsonify({'userId': api_key_data['user_id']})`,
        highlightLanguage: 'python',
        filename: 'app.py'
      },
    ] as CodeExample[],

    'validate-team-api-key': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `import { stackServerApp } from "@/stack/server";

export async function POST(request: Request) {
  const apiKey = request.headers.get('X-Stack-Api-Key');
  
  if (!apiKey) {
    return Response.json({ error: 'API key required' }, { status: 401 });
  }
  
  // Validate the team API key and get the associated team
  const team = await stackServerApp.getTeam({ apiKey });
  
  if (!team) {
    return Response.json({ error: 'Invalid team API key' }, { status: 401 });
  }
  
  // Process team-level request
  const teamData = {
    teamId: team.id,
    teamName: team.displayName,
    // Your team API logic here
  };
  
  return Response.json(teamData);
}`,
        highlightLanguage: 'typescript',
        filename: 'app/api/team-protected/route.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        code: `import { StackServerApp } from "@stackframe/js";

const stackServerApp = new StackServerApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});

app.post('/api/team-protected', async (req, res) => {
  const apiKey = req.headers['x-stack-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  const team = await stackServerApp.getTeam({ apiKey });
  
  if (!team) {
    return res.status(401).json({ error: 'Invalid team API key' });
  }
  
  res.json({
    teamId: team.id,
    teamName: team.displayName,
  });
});`,
        highlightLanguage: 'javascript',
        filename: 'server.js'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        code: `import { StackServerApp } from "@stackframe/js";

const stackServerApp = new StackServerApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});

async function validateTeamApiKey(apiKey) {
  const team = await stackServerApp.getTeam({ apiKey });
  
  if (!team) {
    throw new Error('Invalid team API key');
  }
  
  return team;
}`,
        highlightLanguage: 'javascript',
        filename: 'lib/auth.js'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import requests
from django.http import JsonResponse

def team_protected_view(request):
    api_key = request.headers.get('X-Stack-Api-Key')
    
    if not api_key:
        return JsonResponse({'error': 'API key required'}, status=401)
    
    # Validate team API key with Stack Auth server API
    response = requests.post(
        'https://api.stack-auth.com/api/v1/team-api-keys/check',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        json={
            'api_key': api_key,
        }
    )
    
    if response.status_code != 200:
        return JsonResponse({'error': 'Invalid team API key'}, status=401)
    
    api_key_data = response.json()
    return JsonResponse({'teamId': api_key_data['team_id']})`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `import requests
from fastapi import FastAPI, Header, HTTPException

app = FastAPI()

@app.post("/api/team-protected")
async def team_protected_route(x_stack_api_key: str = Header(None)):
    if not x_stack_api_key:
        raise HTTPException(status_code=401, detail="API key required")
    
    # Validate team API key with Stack Auth server API
    response = requests.post(
        'https://api.stack-auth.com/api/v1/team-api-keys/check',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        json={
            'api_key': x_stack_api_key,
        }
    )
    
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid team API key")
    
    api_key_data = response.json()
    return {"teamId": api_key_data['team_id']}`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/api/team-protected', methods=['POST'])
def team_protected_route():
    api_key = request.headers.get('X-Stack-Api-Key')
    
    if not api_key:
        return jsonify({'error': 'API key required'}), 401
    
    # Validate team API key with Stack Auth server API
    response = requests.post(
        'https://api.stack-auth.com/api/v1/team-api-keys/check',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        json={
            'api_key': api_key,
        }
    )
    
    if response.status_code != 200:
        return jsonify({'error': 'Invalid team API key'}), 401
    
    api_key_data = response.json()
    return jsonify({'teamId': api_key_data['team_id']})`,
        highlightLanguage: 'python',
        filename: 'app.py'
      },
    ] as CodeExample[],

    'check-api-key-validity': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `"use client";
import { useUser } from "@stackframe/stack";

export default function CheckApiKeyValidity({ apiKeyId }: { apiKeyId: string }) {
  const user = useUser({ or: 'redirect' });
  const apiKeys = user.useApiKeys();
  
  const apiKey = apiKeys.find(key => key.id === apiKeyId);
  
  if (!apiKey) {
    return <div>API key not found</div>;
  }
  
  if (apiKey.isValid()) {
    return <div>✓ API key is valid</div>;
  }
  
  const reason = apiKey.whyInvalid();
  return <div>✗ API key is invalid: {reason}</div>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/check-api-key.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

export default async function CheckApiKeyValidity({ 
  userId, 
  apiKeyId 
}: { 
  userId: string,
  apiKeyId: string 
}) {
  const user = await stackServerApp.getUser(userId);
  if (!user) return <div>User not found</div>;
  
  const apiKeys = await user.listApiKeys();
  const apiKey = apiKeys.find(key => key.id === apiKeyId);
  
  if (!apiKey) {
    return <div>API key not found</div>;
  }
  
  if (apiKey.isValid()) {
    return <div>✓ API key is valid</div>;
  }
  
  const reason = apiKey.whyInvalid();
  return <div>✗ API key is invalid: {reason}</div>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/check-api-key.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `"use client";
import { useUser } from "@stackframe/react";

export default function CheckApiKeyValidity({ apiKeyId }: { apiKeyId: string }) {
  const user = useUser({ or: 'redirect' });
  const apiKeys = user.useApiKeys();
  
  const apiKey = apiKeys.find(key => key.id === apiKeyId);
  
  if (!apiKey) {
    return <div>API key not found</div>;
  }
  
  if (apiKey.isValid()) {
    return <div>✓ API key is valid</div>;
  }
  
  const reason = apiKey.whyInvalid();
  return <div>✗ API key is invalid: {reason}</div>;
}`,
        highlightLanguage: 'typescript',
        filename: 'components/CheckApiKey.tsx'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import requests
import time
from django.http import JsonResponse

def check_api_key_validity(request, api_key_id):
    # Get the current user's access token from session/cookie
    access_token = request.COOKIES.get('stack-access-token')
    
    # Get API key details via client API
    response = requests.get(
        f'https://api.stack-auth.com/api/v1/user-api-keys/{api_key_id}',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        }
    )
    
    if response.status_code != 200:
        return JsonResponse({'error': 'API key not found'}, status=404)
    
    api_key = response.json()
    
    # Check if manually revoked
    if api_key.get('manually_revoked_at_millis'):
        return JsonResponse({
            'valid': False,
            'reason': 'manually-revoked'
        })
    
    # Check if expired
    if api_key.get('expires_at_millis'):
        if api_key['expires_at_millis'] < time.time() * 1000:
            return JsonResponse({
                'valid': False,
                'reason': 'expired'
            })
    
    return JsonResponse({'valid': True})`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `import requests
import time
from fastapi import Cookie, HTTPException

@app.get("/api/check-api-key/{api_key_id}")
async def check_api_key_validity(api_key_id: str, stack_access_token: str = Cookie(None, alias="stack-access-token")):
    if not stack_access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Get API key details via client API
    response = requests.get(
        f'https://api.stack-auth.com/api/v1/user-api-keys/{api_key_id}',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': stack_access_token,
        }
    )
    
    if response.status_code != 200:
        raise HTTPException(status_code=404, detail="API key not found")
    
    api_key = response.json()
    
    # Check if manually revoked
    if api_key.get('manually_revoked_at_millis'):
        return {
            'valid': False,
            'reason': 'manually-revoked'
        }
    
    # Check if expired
    if api_key.get('expires_at_millis'):
        if api_key['expires_at_millis'] < time.time() * 1000:
            return {
                'valid': False,
                'reason': 'expired'
            }
    
    return {'valid': True}`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests
import time
from flask import request, jsonify

@app.route('/api/check-api-key/<api_key_id>', methods=['GET'])
def check_api_key_validity(api_key_id):
    access_token = request.cookies.get('stack-access-token')
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Get API key details via client API
    response = requests.get(
        f'https://api.stack-auth.com/api/v1/user-api-keys/{api_key_id}',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        }
    )
    
    if response.status_code != 200:
        return jsonify({'error': 'API key not found'}), 404
    
    api_key = response.json()
    
    # Check if manually revoked
    if api_key.get('manually_revoked_at_millis'):
        return jsonify({
            'valid': False,
            'reason': 'manually-revoked'
        })
    
    # Check if expired
    if api_key.get('expires_at_millis'):
        if api_key['expires_at_millis'] < time.time() * 1000:
            return jsonify({
                'valid': False,
                'reason': 'expired'
            })
    
    return jsonify({'valid': True})`,
        highlightLanguage: 'python',
        filename: 'app.py'
      },
    ] as CodeExample[],

    'account-settings-examples': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `import { AccountSettings } from '@stackframe/stack';

export default function MyAccountPage() {
  return (
    <AccountSettings
      fullPage={true}
    />
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/src/account-page.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { AccountSettings } from '@stackframe/react';

export default function MyAccountPage() {
  return (
    <AccountSettings
      fullPage={true}
    />
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/src/account-page.tsx'
      }
    ]
  },
};

