import { StackProvider, StackTheme, useUser } from "@stackframe/react";
import { stackClientApp } from "./stack";

function UserProfile() {
  const user = useUser();

  if (!user) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h2>Welcome to Stack Auth Extension</h2>
        <p>Please sign in to continue</p>
        <button
          onClick={() => stackClientApp.signInWithPopup()}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            marginTop: '10px'
          }}
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Welcome back!</h2>
      <div style={{ marginTop: '15px' }}>
        <p><strong>Email:</strong> {user.primaryEmail}</p>
        <p><strong>User ID:</strong> {user.id}</p>
      </div>
      <button
        onClick={() => stackClientApp.signOut()}
        style={{
          padding: '10px 20px',
          fontSize: '16px',
          backgroundColor: '#dc3545',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
          marginTop: '15px'
        }}
      >
        Sign Out
      </button>
    </div>
  );
}

function App() {
  return (
    <StackProvider app={stackClientApp}>
      <StackTheme>
        <UserProfile />
      </StackTheme>
    </StackProvider>
  );
}

export default App;
