'use client';

import { useUser } from '@stackframe/stack';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { decodeProtectedHeader, decodeJwt as joseDecodeJwt } from 'jose';
import { useCallback, useState } from 'react';
import { cn } from '../../lib/cn';

type DecodedJWT = {
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  signature: string,
};

// Simple JWT decoding
const decodeJWT = (jwt: string): DecodedJWT => {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  return {
    header: decodeProtectedHeader(jwt) as Record<string, unknown>,
    payload: joseDecodeJwt(jwt) as Record<string, unknown>,
    signature: parts[2]!,
  };
};


type JWTViewerProps = {
  defaultToken?: string,
  className?: string,
};

export function JWTViewer({ defaultToken = '', className = '' }: JWTViewerProps) {
  const [token, setToken] = useState(defaultToken);
  const [decoded, setDecoded] = useState<DecodedJWT | null>(null);
  const [error, setError] = useState<string>('');
  const [userTokenLoaded, setUserTokenLoaded] = useState(false);

  const user = useUser();

  const handleDecode = useCallback((jwtString: string) => {
    if (!jwtString.trim()) {
      setDecoded(null);
      setError('');
      return;
    }

    try {
      setDecoded(decodeJWT(jwtString));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JWT');
      setDecoded(null);
    }
  }, []);


  const loadCurrentUserToken = async () => {
    if (user) {
      try {
        const authData = await user.getAuthJson();
        if (authData.accessToken) {
          setToken(authData.accessToken);
          handleDecode(authData.accessToken);
          setUserTokenLoaded(true);
        }
      } catch (err) {
        console.error('Failed to load user token:', err);
      }
    }
  };

  const formatTime = (timestamp: number, field: string) => {
    const date = new Date(timestamp * 1000);
    const now = Date.now() / 1000;

    // Only check for expiration on 'exp' field
    const isExpired = field === 'exp' && now > timestamp;
    // For 'nbf' (not before), check if it's not yet valid
    const notYetValid = field === 'nbf' && now < timestamp;

    return (
      <span className={cn(
        "text-xs",
        isExpired ? 'text-red-500 dark:text-red-400' :
          notYetValid ? 'text-amber-500 dark:text-amber-400' :
            'text-fd-muted-foreground'
      )}>
        {date.toLocaleString()}
        {isExpired && '(EXPIRED)'}
        {notYetValid && '(NOT YET VALID)'}
      </span>
    );
  };

  const renderValue = (key: string, value: unknown) => {
    if (key === 'exp' || key === 'iat' || key === 'nbf') {
      return (
        <div className="space-y-1">
          <code className="text-fd-foreground">{String(value)}</code>
          {typeof value === 'number' && (
            <div>{formatTime(value, key)}</div>
          )}
        </div>
      );
    }
    if (typeof value === 'object') {
      return <code className="text-fd-foreground break-all">{JSON.stringify(value)}</code>;
    }
    return <code className="text-fd-foreground">{String(value)}</code>;
  };

  return (
    <div className={cn("not-prose space-y-4", className)}>
      {/* Input Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-fd-foreground">JWT Token</label>
          {user && (
            <button
              onClick={() => runAsynchronously(loadCurrentUserToken())}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                "bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90",
                "border border-fd-border"
              )}
            >
              {userTokenLoaded ? 'Reload My Token' : 'Load My Token'}
            </button>
          )}
        </div>

        <div className="relative">
          <textarea
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              handleDecode(e.target.value);
              setUserTokenLoaded(false);
            }}
            placeholder={user ? "Click 'Load My Token' to use your session token, or paste another here..." : "Paste JWT token here..."}
            className={cn(
              "w-full h-24 p-3 text-xs font-mono rounded-lg resize-vertical",
              "bg-fd-background border border-fd-border",
              "text-fd-foreground placeholder:text-fd-muted-foreground",
              "focus:outline-none focus:ring-2 focus:ring-fd-primary/20 focus:border-fd-primary",
              "transition-colors"
            )}
          />
          {userTokenLoaded && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-fd-primary">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              Currently showing your session token
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className={cn(
          "p-3 rounded-lg border border-dashed",
          "border-red-400/30 dark:border-red-400/20",
          "bg-red-50/50 dark:bg-red-900/10"
        )}>
          <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        </div>
      )}

      {/* Decoded JWT */}
      {decoded && (
        <div className="space-y-4">
          {/* Header */}
          <div className={cn(
            "rounded-lg border border-fd-border/50 bg-fd-card shadow-sm",
            "overflow-hidden"
          )}>
            <div className="px-4 py-3 border-b border-fd-border/50 bg-fd-muted/30">
              <div className="text-sm font-medium text-fd-foreground flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                Header
              </div>
            </div>
            <div className="p-4 space-y-2">
              {Object.entries(decoded.header).map(([key, value]) => (
                <div key={key} className="flex items-start gap-3 text-sm">
                  <span className="text-fd-muted-foreground font-mono min-w-0 flex-shrink-0">
                    {key}:
                  </span>
                  <div className="min-w-0 flex-1">
                    {renderValue(key, value)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Payload */}
          <div className={cn(
            "rounded-lg border border-fd-border/50 bg-fd-card shadow-sm",
            "overflow-hidden"
          )}>
            <div className="px-4 py-3 border-b border-fd-border/50 bg-fd-muted/30">
              <div className="text-sm font-medium text-fd-foreground flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                Payload
              </div>
            </div>
            <div className="p-4 space-y-2">
              {Object.entries(decoded.payload).map(([key, value]) => (
                <div key={key} className="flex items-start gap-3 text-sm">
                  <span className="text-fd-muted-foreground font-mono min-w-0 flex-shrink-0">
                    {key}:
                  </span>
                  <div className="min-w-0 flex-1">
                    {renderValue(key, value)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Signature */}
          <div className={cn(
            "rounded-lg border border-fd-border/50 bg-fd-card shadow-sm",
            "overflow-hidden"
          )}>
            <div className="px-4 py-3 border-b border-fd-border/50 bg-fd-muted/30">
              <div className="text-sm font-medium text-fd-foreground flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                Signature
              </div>
            </div>
            <div className="p-4">
              <code className="text-xs font-mono break-all text-fd-muted-foreground block">
                {decoded.signature}
              </code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
