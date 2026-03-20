"use client";

import React, { useCallback, useState } from "react";

// IF_PLATFORM react-like

/**
 * Shared iframe tab component used by Docs, Dashboard, and Support tabs.
 * Handles loading/error states, retry, and "open in new tab" fallback.
 */
export function IframeTab({
  src,
  title,
  loadingMessage = "Loading…",
  errorMessage = "Unable to load content",
  errorDetail,
}: {
  src: string;
  title: string;
  loadingMessage?: string;
  errorMessage?: string;
  errorDetail?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const handleLoad = useCallback(() => {
    setLoading(false);
    setError(false);
  }, []);

  const handleError = useCallback(() => {
    setLoading(false);
    setError(true);
  }, []);

  const retry = useCallback(() => {
    setLoading(true);
    setError(false);
  }, []);

  if (error) {
    return (
      <div className="sdt-iframe-container">
        <div className="sdt-iframe-error">
          <div>{errorMessage}</div>
          {errorDetail && (
            <div style={{ fontSize: '12px', color: 'var(--sdt-text-tertiary)' }}>
              {errorDetail}
            </div>
          )}
          <button className="sdt-iframe-error-btn" onClick={retry}>
            Retry
          </button>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--sdt-accent)', fontSize: '12px', textDecoration: 'none' }}
          >
            Open in new tab
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="sdt-iframe-container">
      {loading && (
        <div className="sdt-iframe-loading">{loadingMessage}</div>
      )}
      <iframe
        src={src}
        title={title}
        onLoad={handleLoad}
        onError={handleError}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        style={{ display: loading ? 'none' : 'block' }}
      />
    </div>
  );
}

// END_PLATFORM
