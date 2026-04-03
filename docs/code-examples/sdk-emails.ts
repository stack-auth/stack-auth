
export const sdkEmailsExamples = {
  'types/email': {
    'send-html-email': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client' as const,
        code: `// ⚠️ Email sending is not available on the client side
// 
// The sendEmail() method requires SECRET_SERVER_KEY and can only
// be used from server-side code (Server Components, API routes, etc.)
//
// To send emails from a client component, create an API route that
// calls stackServerApp.sendEmail() and call it from your client code.

// Example: Call a server API route from client
async function sendEmailFromClient() {
  const response = await fetch('/api/send-email', {
    method: 'POST',
    body: JSON.stringify({
      userIds: ['user-1', 'user-2'],
      subject: 'Welcome!',
      html: '<h1>Welcome!</h1>'
    })
  });
  
  return response.json();
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/send-email-button.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server' as const,
        code: `import { stackServerApp } from "@/stack";

export default async function SendWelcomeEmail() {
  const result = await stackServerApp.sendEmail({
    userIds: ['user-1', 'user-2'],
    subject: 'Welcome to our platform!',
    html: '<h1>Welcome!</h1><p>Thanks for joining us.</p>',
  });
  
  if (result.status === 'error') {
    console.error('Failed to send email:', result.error);
  }
  
  return <div>Email sent!</div>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/api/send-email/route.ts'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests

def send_welcome_email():
    response = requests.post(
        'https://api.stack-auth.com/api/v1/emails/send',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        json={
            'user_ids': ['user-1', 'user-2'],
            'subject': 'Welcome to our platform!',
            'html': '<h1>Welcome!</h1><p>Thanks for joining us.</p>',
        }
    )
    
    return response.json()`,
        highlightLanguage: 'python',
        filename: 'send_email.py'
      }
    ],
    'send-template-email': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client' as const,
        code: `// ⚠️ Email sending is not available on the client side
// 
// The sendEmail() method requires SECRET_SERVER_KEY and can only
// be used from server-side code (Server Components, API routes, etc.)
//
// To send emails from a client component, create an API route that
// calls stackServerApp.sendEmail() and call it from your client code.

// Example: Call a server API route from client
async function sendTemplateEmailFromClient() {
  const response = await fetch('/api/send-template-email', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'user-1',
      templateId: 'welcome-template',
      variables: { userName: 'John Doe' }
    })
  });
  
  return response.json();
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/send-email-button.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server' as const,
        code: `import { stackServerApp } from "@/stack";

export default async function SendTemplateEmail() {
  const result = await stackServerApp.sendEmail({
    userIds: ['user-1'],
    templateId: 'welcome-template',
    variables: {
      userName: 'John Doe',
      activationUrl: 'https://app.com/activate/token123'
    },
    subject: 'Welcome aboard!',
    notificationCategoryName: 'product_updates'
  });
  
  if (result.status === 'error') {
    console.error('Failed to send email:', result.error);
  }
  
  return <div>Template email sent!</div>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/api/send-template-email/route.ts'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests

def send_template_email():
    response = requests.post(
        'https://api.stack-auth.com/api/v1/emails/send',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        json={
            'user_ids': ['user-1'],
            'template_id': 'welcome-template',
            'variables': {
                'userName': 'John Doe',
                'activationUrl': 'https://app.com/activate/token123'
            },
            'subject': 'Welcome aboard!',
            'notification_category_name': 'product_updates'
        }
    )
    
    return response.json()`,
        highlightLanguage: 'python',
        filename: 'send_template_email.py'
      }
    ]
  }
};

