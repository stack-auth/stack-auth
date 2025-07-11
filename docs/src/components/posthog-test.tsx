'use client';

import { usePostHog } from 'posthog-js/react';

export default function PostHogTest() {
  const posthog = usePostHog();

  const sendTestEvent = () => {
    console.log('Sending test event to PostHog...');
    posthog.capture('docs_test_event', {
      test_property: 'Hello from Stack Docs!',
      timestamp: new Date().toISOString(),
      location: window.location.href,
      user_agent: navigator.userAgent,
    });
    console.log('Test event sent!');
    alert('Test event sent to PostHog! Check the console and your PostHog dashboard.');
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 9999,
      background: '#4f46e5',
      color: 'white',
      padding: '10px 15px',
      borderRadius: '8px',
      border: 'none',
      cursor: 'pointer',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
    }}>
      <button onClick={sendTestEvent} style={{
        background: 'none',
        border: 'none',
        color: 'white',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '500'
      }}>
        🧪 Test PostHog
      </button>
    </div>
  );
}
