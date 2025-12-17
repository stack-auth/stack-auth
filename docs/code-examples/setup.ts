import { CodeExample } from '../lib/code-examples';

export const setupExamples = {
  'overview': {
    'install': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `npx @stackframe/init-stack@latest`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      }
    ] as CodeExample[],
    'use-auth': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `const user = useUser({ or: "redirect" });
return <div>Hi, {user.displayName}</div>;`,
        highlightLanguage: 'tsx',
        filename: 'page.tsx'
      }
    ] as CodeExample[],
  },
  'setup': {
    'env-wizard': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
STACK_SECRET_SERVER_KEY=<your-secret-server-key>`,
        highlightLanguage: 'bash',
        filename: '.env.local'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `// Update the values in stack/client.ts created by the wizard
export const stackClientApp = new StackClientApp({
  projectId: "your-project-id",
  publishableClientKey: "your-publishable-client-key",
  tokenStore: "cookie",
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/client.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Vanilla JavaScript',
        code: `STACK_PROJECT_ID=<your-project-id>
STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
STACK_SECRET_SERVER_KEY=<your-secret-server-key>`,
        highlightLanguage: 'bash',
        filename: '.env'
      }
    ] as CodeExample[],

    'install-package': [
      { language: 'JavaScript', framework: 'Next.js', code: 'npm install @stackframe/stack', highlightLanguage: 'bash', filename: 'Terminal' },
      { language: 'JavaScript', framework: 'React', code: 'npm install @stackframe/react', highlightLanguage: 'bash', filename: 'Terminal' },
      { language: 'JavaScript', framework: 'Express', code: 'npm install @stackframe/js', highlightLanguage: 'bash', filename: 'Terminal' },
      { language: 'JavaScript', framework: 'Node.js', code: 'npm install @stackframe/js', highlightLanguage: 'bash', filename: 'Terminal' },
      { language: 'Python', framework: 'Django', code: 'pip install requests', highlightLanguage: 'bash', filename: 'Terminal' },
      { language: 'Python', framework: 'FastAPI', code: 'pip install requests', highlightLanguage: 'bash', filename: 'Terminal' },
      { language: 'Python', framework: 'Flask', code: 'pip install requests', highlightLanguage: 'bash', filename: 'Terminal' },
    ] as CodeExample[],

    'env-config': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
STACK_SECRET_SERVER_KEY=<your-secret-server-key>`,
        highlightLanguage: 'bash',
        filename: '.env.local'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `# Store these in environment variables or directly in the client file during development
VITE_STACK_PROJECT_ID=<your-project-id>
VITE_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>`,
        highlightLanguage: 'bash',
        filename: '.env'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        code: `STACK_PROJECT_ID=<your-project-id>
STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
STACK_SECRET_SERVER_KEY=<your-secret-server-key>`,
        highlightLanguage: 'bash',
        filename: '.env'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        code: `STACK_PROJECT_ID=<your-project-id>
STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
STACK_SECRET_SERVER_KEY=<your-secret-server-key>`,
        highlightLanguage: 'bash',
        filename: '.env'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import os

stack_project_id = os.getenv("STACK_PROJECT_ID")
stack_publishable_client_key = os.getenv("STACK_PUBLISHABLE_CLIENT_KEY")
stack_secret_server_key = os.getenv("STACK_SECRET_SERVER_KEY")`,
        highlightLanguage: 'python',
        filename: 'settings.py'
      },
      {
        language: 'Python',        framework: 'FastAPI',
        code: `import os

stack_project_id = os.getenv("STACK_PROJECT_ID")
stack_publishable_client_key = os.getenv("STACK_PUBLISHABLE_CLIENT_KEY")
stack_secret_server_key = os.getenv("STACK_SECRET_SERVER_KEY")`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import os

stack_project_id = os.getenv("STACK_PROJECT_ID")
stack_publishable_client_key = os.getenv("STACK_PUBLISHABLE_CLIENT_KEY")
stack_secret_server_key = os.getenv("STACK_SECRET_SERVER_KEY")`,
        highlightLanguage: 'python',
        filename: 'app.py'
      }
    ] as CodeExample[],

    'stack-config': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import "server-only";
import { StackServerApp } from "@stackframe/stack";

export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie", // storing auth tokens in cookies
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `import { StackClientApp } from "@stackframe/stack";

export const stackClientApp = new StackClientApp({
  // Environment variables are automatically read
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/client.ts'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { StackClientApp } from "@stackframe/react";
// If you use React Router, uncomment the next line and the redirectMethod below
// import { useNavigate } from "react-router-dom";

export const stackClientApp = new StackClientApp({
  projectId: process.env.VITE_STACK_PROJECT_ID || "your-project-id",
  publishableClientKey: process.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY || "your-publishable-client-key",
  tokenStore: "cookie",
  // redirectMethod: { useNavigate }, // Optional: only if using react-router-dom
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/client.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        variant: 'server',
        code: `import { StackServerApp } from "@stackframe/js";

export const stackServerApp = new StackServerApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        variant: 'client',
        code: `import { StackClientApp } from "@stackframe/js";

export const stackClientApp = new StackClientApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/client.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        variant: 'server',
        code: `import { StackServerApp } from "@stackframe/js";

export const stackServerApp = new StackServerApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});`,
        highlightLanguage: 'javascript',
        filename: 'stack/server.js'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        variant: 'client',
        code: `import { StackClientApp } from "@stackframe/js";

export const stackClientApp = new StackClientApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
});`,
        highlightLanguage: 'javascript',
        filename: 'stack/client.js'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import requests

def stack_auth_request(method, endpoint, **kwargs):
    res = requests.request(
        method,
        f'https://api.stack-auth.com/{endpoint}',
        headers={
            'x-stack-access-type': 'server',  # or 'client' if you're only accessing the client API
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,  # not necessary if access type is 'client'
            **kwargs.pop('headers', {}),
        },
        **kwargs,
    )
    if res.status_code >= 400:
        raise Exception(f"Stack Auth API request failed with {res.status_code}: {res.text}")
    return res.json()`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `import requests

def stack_auth_request(method, endpoint, **kwargs):
    res = requests.request(
        method,
        f'https://api.stack-auth.com/{endpoint}',
        headers={
            'x-stack-access-type': 'server',  # or 'client' if you're only accessing the client API
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,  # not necessary if access type is 'client'
            **kwargs.pop('headers', {}),
        },
        **kwargs,
    )
    if res.status_code >= 400:
        raise Exception(f"Stack Auth API request failed with {res.status_code}: {res.text}")
    return res.json()`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests

def stack_auth_request(method, endpoint, **kwargs):
    res = requests.request(
        method,
        f'https://api.stack-auth.com/{endpoint}',
        headers={
            'x-stack-access-type': 'server',  # or 'client' if you're only accessing the client API
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,  # not necessary if access type is 'client'
            **kwargs.pop('headers', {}),
        },
        **kwargs,
    )
    if res.status_code >= 400:
        raise Exception(f"Stack Auth API request failed with {res.status_code}: {res.text}")
    return res.json()`,
        highlightLanguage: 'python',
        filename: 'app.py'
      }
    ] as CodeExample[],

    'auth-handlers': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `import { StackHandler } from "@stackframe/stack";
import { stackServerApp } from "@/stack/server";

export default function Handler(props: unknown) {
  return <StackHandler fullPage app={stackServerApp} routeProps={props} />;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/handler/[...stack]/page.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { StackHandler, StackProvider, StackTheme } from "@stackframe/react";
import { Suspense } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { stackClientApp } from "./stack/client";

function HandlerRoutes() {
  const location = useLocation();
  return (
    <StackHandler app={stackClientApp} location={location.pathname} fullPage />
  );
}

export default function App() {
  return (
    <Suspense fallback={null}>
      <BrowserRouter>
        <StackProvider app={stackClientApp}>
          <StackTheme>
            <Routes>
              <Route path="/handler/*" element={<HandlerRoutes />} />
              <Route path="/" element={<div>hello world</div>} />
            </Routes>
          </StackTheme>
        </StackProvider>
      </BrowserRouter>
    </Suspense>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'App.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        code: `// Express doesn't use built-in handlers
// Use the REST API or integrate with your frontend`,
        highlightLanguage: 'typescript',
        filename: 'Note'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        code: `// Node.js doesn't use built-in handlers
// Use the REST API or integrate with your frontend`,
        highlightLanguage: 'javascript',
        filename: 'Note'
      }
    ] as CodeExample[],

    'app-providers': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `import React from "react";
import { StackProvider, StackTheme } from "@stackframe/stack";
import { stackServerApp } from "@/stack/server";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StackProvider app={stackServerApp}>
          <StackTheme>
            {children}
          </StackTheme>
        </StackProvider>
      </body>
    </html>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/layout.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `// Already shown in the App.tsx example above
// Make sure to wrap your app with StackProvider and StackTheme`,
        highlightLanguage: 'typescript',
        filename: 'Note'
      }
    ] as CodeExample[],

    'loading-boundary': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `export default function Loading() {
  // You can use any loading indicator here
  return <>
    Loading...
  </>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/loading.tsx'
      }
    ] as CodeExample[],

    'suspense-boundary': [
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { Suspense } from "react";
import { StackProvider } from "@stackframe/react";
import { stackClientApp } from "./stack/client";

export default function App() {
  return (
    // Wrap your StackProvider with Suspense for async hooks to work
    <Suspense fallback={<div>Loading...</div>}>
      <StackProvider app={stackClientApp}>
        {/* Your app content */}
      </StackProvider>
    </Suspense>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'App.tsx'
      }
    ] as CodeExample[],

    'test-setup': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `# Start your Next.js app
npm run dev

# Navigate to the sign-up page
# http://localhost:3000/handler/sign-up`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `# Start your React app
npm run dev

# Navigate to the sign-up page
# http://localhost:5173/handler/sign-up`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        code: `# Start your Express server
npm start

# Use the REST API or integrate with your frontend
# Check the REST API documentation for endpoints`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        code: `# Start your Node.js app
node index.js

# Use the REST API or integrate with your frontend
# Check the REST API documentation for endpoints`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `# Test the Stack Auth API connection
print(stack_auth_request('GET', '/api/v1/projects/current'))

# Start your Django server
python manage.py runserver`,
        highlightLanguage: 'python',
        filename: 'Terminal'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `# Test the Stack Auth API connection
print(stack_auth_request('GET', '/api/v1/projects/current'))

# Start your FastAPI server
uvicorn main:app --reload`,
        highlightLanguage: 'python',
        filename: 'Terminal'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `# Test the Stack Auth API connection
print(stack_auth_request('GET', '/api/v1/projects/current'))

# Start your Flask server
flask run`,
        highlightLanguage: 'python',
        filename: 'Terminal'
      }
    ] as CodeExample[],

    'basic-usage': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

// In a Server Component or API route
const user = await stackServerApp.getUser();
if (user) {
  console.log("User is signed in:", user.displayName);
} else {
  console.log("User is not signed in");
}`,
        highlightLanguage: 'typescript',
        filename: 'Server Component'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `'use client';
import { useUser } from "@stackframe/stack";

export default function MyComponent() {
  const user = useUser();
  
  if (user) {
    return <div>Hello, {user.displayName}!</div>;
  } else {
    return <div>Please sign in</div>;
  }
}`,
        highlightLanguage: 'typescript',
        filename: 'Client Component'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { useUser } from "@stackframe/react";

export default function MyComponent() {
  const user = useUser();
  
  if (user) {
    return <div>Hello, {user.displayName}!</div>;
  } else {
    return <div>Please sign in</div>;
  }
}`,
        highlightLanguage: 'typescript',
        filename: 'Component'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        code: `import { stackServerApp } from "./stack/server.js";

app.get('/profile', async (req, res) => {
  try {
    // Get access token from request headers
    const accessToken = req.headers['x-stack-access-token'];
    const user = await stackServerApp.getUser({ accessToken });
    
    if (user) {
      res.json({ message: \`Hello, \${user.displayName}!\` });
    } else {
      res.status(401).json({ error: 'Not authenticated' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});`,
        highlightLanguage: 'typescript',
        filename: 'server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        code: `import { stackServerApp } from "./stack/server.js";

async function checkUser(accessToken) {
  try {
    const user = await stackServerApp.getUser({ accessToken });
    
    if (user) {
      console.log(\`Hello, \${user.displayName}!\`);
    } else {
      console.log('User not authenticated');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}`,
        highlightLanguage: 'javascript',
        filename: 'index.js'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `# In your views.py
def profile_view(request):
    # Get access token from request headers
    access_token = request.headers.get('X-Stack-Access-Token')
    
    try:
        user_data = stack_auth_request('GET', '/api/v1/users/me', headers={
            'x-stack-access-token': access_token,
        })
        return JsonResponse({'message': f"Hello, {user_data['displayName']}!"})
    except Exception as e:
        return JsonResponse({'error': 'Not authenticated'}, status=401)`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `from fastapi import FastAPI, Header, HTTPException

app = FastAPI()

@app.get("/profile")
async def get_profile(x_stack_access_token: str = Header(None)):
    if not x_stack_access_token:
        raise HTTPException(status_code=401, detail="Access token required")
    
    try:
        user_data = stack_auth_request('GET', '/api/v1/users/me', headers={
            'x-stack-access-token': x_stack_access_token,
        })
        return {"message": f"Hello, {user_data['displayName']}!"}
    except Exception as e:
        raise HTTPException(status_code=401, detail="Not authenticated")`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/profile')
def profile():
    access_token = request.headers.get('X-Stack-Access-Token')
    
    if not access_token:
        return jsonify({'error': 'Access token required'}), 401
    
    try:
        user_data = stack_auth_request('GET', '/api/v1/users/me', headers={
    'x-stack-access-token': access_token,
        })
        return jsonify({'message': f"Hello, {user_data['displayName']}!"})
    except Exception as e:
        return jsonify({'error': 'Not authenticated'}), 401`,
        highlightLanguage: 'python',
        filename: 'app.py'
      }
    ] as CodeExample[]
  }
};

