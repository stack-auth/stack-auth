import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <div className="container">
        <div className="empty-state" style={{ paddingTop: '120px' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '16px' }}>Page Not Found</h1>
          <p style={{ marginBottom: '24px' }}>
            The page you&apos;re looking for doesn&apos;t exist.
          </p>
          <Link 
            href="/" 
            style={{ 
              color: 'var(--accent-minor)', 
              textDecoration: 'underline' 
            }}
          >
            ← Back to Changelog
          </Link>
        </div>
      </div>
    </main>
  );
}

