'use client';

import { useUser } from '@stackframe/stack';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { decodeProtectedHeader, decodeJwt as joseDecodeJwt } from 'jose';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const user = useUser();

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

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

  const handleCopy = useCallback(async (text: string, key: string) => {
    if (!text) return;
    try {
      if (
        typeof navigator !== 'undefined' &&
        'clipboard' in navigator &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', '');
        temp.style.position = 'absolute';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      setCopiedKey(key);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopiedKey(null);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy value', err);
    }
  }, [copyTimeoutRef]);


  const loadCurrentUserToken = useCallback(async () => {
    if (!user) return;
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
  }, [handleDecode, user]);

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

  const tokenParts = useMemo(() => token.split('.'), [token]);
  const hasTokenSegments = tokenParts.length === 3 && tokenParts.every(Boolean);

  const tokenMeta = useMemo(() => {
    if (!decoded) return null;
    const payload = decoded.payload;
    const now = Math.floor(Date.now() / 1000);
    const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
    const iat = typeof payload.iat === 'number' ? payload.iat : undefined;
    const nbf = typeof payload.nbf === 'number' ? payload.nbf : undefined;
    const issuer = typeof payload.iss === 'string' ? payload.iss : undefined;
    const audience = Array.isArray(payload.aud)
      ? payload.aud.map(String).join(', ')
      : typeof payload.aud === 'string'
        ? payload.aud
        : undefined;
    const subject = typeof payload.sub === 'string' ? payload.sub : undefined;
    const status = exp !== undefined && exp < now
      ? 'expired'
      : nbf !== undefined && nbf > now
        ? 'pending'
        : 'active';

    return { status, exp, iat, nbf, issuer, audience, subject } as const;
  }, [decoded]);

  const summaryRows: Array<{ key: string, label: string, content: JSX.Element }> = [];
  if (decoded && tokenMeta) {
    if (tokenMeta.issuer) {
      summaryRows.push({
        key: 'issuer',
        label: 'Issuer',
        content: (
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono break-all text-fd-foreground flex-1">{tokenMeta.issuer}</code>
            <button
              type="button"
              onClick={() => runAsynchronously(() => handleCopy(tokenMeta.issuer!, 'issuer'))}
              className={cn(
                "px-2 py-1 text-[11px] font-medium rounded-md border",
                "border-fd-border bg-fd-muted/20 text-fd-muted-foreground hover:bg-fd-muted/40",
                "transition-colors"
              )}
            >
              {copiedKey === 'issuer' ? 'Copied' : 'Copy'}
            </button>
          </div>
        ),
      });
    }

    if (tokenMeta.audience) {
      summaryRows.push({
        key: 'audience',
        label: 'Audience',
        content: (
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono break-all text-fd-foreground flex-1">{tokenMeta.audience}</code>
            <button
              type="button"
              onClick={() => runAsynchronously(() => handleCopy(tokenMeta.audience!, 'audience'))}
              className={cn(
                "px-2 py-1 text-[11px] font-medium rounded-md border",
                "border-fd-border bg-fd-muted/20 text-fd-muted-foreground hover:bg-fd-muted/40",
                "transition-colors"
              )}
            >
              {copiedKey === 'audience' ? 'Copied' : 'Copy'}
            </button>
          </div>
        ),
      });
    }

    if (tokenMeta.subject) {
      summaryRows.push({
        key: 'subject',
        label: 'User ID',
        content: <code className="text-xs font-mono break-all text-fd-foreground">{tokenMeta.subject}</code>,
      });
    }

    if (tokenMeta.iat !== undefined) {
      summaryRows.push({
        key: 'iat',
        label: 'Issued At',
        content: renderValue('iat', tokenMeta.iat),
      });
    }

    if (tokenMeta.nbf !== undefined) {
      summaryRows.push({
        key: 'nbf',
        label: 'Not Before',
        content: renderValue('nbf', tokenMeta.nbf),
      });
    }

    if (tokenMeta.exp !== undefined) {
      summaryRows.push({
        key: 'exp',
        label: 'Expires',
        content: renderValue('exp', tokenMeta.exp),
      });
    }
  }

  const statusConfig = {
    active: {
      label: 'Time-Valid (Unverified)',
      className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
    },
    expired: {
      label: 'Expired (Unverified)',
      className: 'bg-red-500/15 text-red-500 border-red-500/30',
    },
    pending: {
      label: 'Not Yet Valid (Unverified)',
      className: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
    },
  } as const;

  const statusBadge = tokenMeta ? statusConfig[tokenMeta.status] : undefined;
  const segmentStyles = [
    { label: 'Header', className: 'border-blue-500/25 bg-blue-500/10 text-blue-500' },
    { label: 'Payload', className: 'border-green-500/25 bg-green-500/10 text-green-500' },
    { label: 'Signature', className: 'border-purple-500/25 bg-purple-500/10 text-purple-500' },
  ] as const;

  return (
    <div className={cn("not-prose space-y-4", className)}>
      {/* Input Section */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="text-sm font-medium text-fd-foreground">JWT Token</label>
          <div className="flex flex-wrap items-center gap-2">
            {token && (
              <button
                type="button"
                onClick={() => runAsynchronously(() => handleCopy(token, 'token'))}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md border",
                  "border-fd-border bg-fd-muted/40 text-fd-muted-foreground hover:bg-fd-muted/60",
                  "transition-colors"
                )}
              >
                {copiedKey === 'token' ? 'Copied' : 'Copy Token'}
              </button>
            )}
            {user && (
              <button
                type="button"
                onClick={() => runAsynchronously(loadCurrentUserToken)}
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
              "w-full h-28 p-3 text-xs font-mono rounded-lg resize-vertical",
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

        {hasTokenSegments && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            {tokenParts.map((segment, index) => (
              <button
                type="button"
                key={segmentStyles[index]!.label}
                onClick={() => runAsynchronously(() => handleCopy(segment, `segment-${index}`))}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-1.5",
                  "transition-colors hover:brightness-[1.05]",
                  segmentStyles[index]!.className
                )}
              >
                <span className="font-semibold uppercase tracking-wide">
                  {segmentStyles[index]!.label}
                </span>
                <span className="truncate max-w-[160px] text-fd-foreground/80">
                  {segment.slice(0, 12)}{segment.length > 12 ? '…' : ''}
                </span>
                <span className="text-[10px] text-fd-muted-foreground">
                  {copiedKey === `segment-${index}` ? 'Copied' : 'Tap to copy'}
                </span>
              </button>
            ))}
          </div>
        )}
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
          {(statusBadge || summaryRows.length > 0) && (
            <div className={cn(
              "rounded-lg border border-fd-border/50 bg-fd-card shadow-sm",
              "overflow-hidden"
            )}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fd-border/50 bg-fd-muted/20 px-4 py-3">
                <div className="text-sm font-medium text-fd-foreground">Token Summary</div>
                {statusBadge && (
                  <span className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-full border",
                    statusBadge.className
                  )}>
                    {statusBadge.label}
                  </span>
                )}
              </div>
              {summaryRows.length > 0 && (
                <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
                  {summaryRows.map((row) => (
                    <div key={row.key} className="space-y-1 rounded-md bg-fd-muted/10 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-fd-muted-foreground">
                        {row.label}
                      </div>
                      <div className="text-sm text-fd-foreground">
                        {row.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
