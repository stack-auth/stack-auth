'use client';

import { useState } from 'react';
import { cn } from '../lib/cn';
import { Info } from './mdx/info';
import { buttonVariants } from './ui/button';

// Simple Button component using existing buttonVariants
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  color?: 'primary' | 'outline' | 'ghost' | 'secondary',
  size?: 'sm' | 'icon' | 'icon-sm',
  children: React.ReactNode,
};

const Button = ({ color = 'primary', size, className, children, ...props }: ButtonProps) => {
  return (
    <button
      className={cn(buttonVariants({ color: color, size }), className)}
      {...props}
    >
      {children}
    </button>
  );
};

// Input component that matches the docs theme
type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string,
  labelOptional?: string,
  reveal?: boolean,
  copy?: boolean,
};

const Input = ({
  label,
  labelOptional,
  reveal,
  copy,
  className,
  ...props
}: InputProps) => {
  const [isRevealed, setIsRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (props.value && typeof props.value === 'string') {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      void setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-1">
      {label && (
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium leading-none text-gray-600 dark:text-gray-400">
            {label}
          </label>
          {labelOptional && (
            <span className="text-xs text-muted-foreground">
              {labelOptional}
            </span>
          )}
        </div>
      )}
      <div className="relative">
        <input
          type={reveal && !isRevealed ? 'password' : 'text'}
          className={cn(
            'flex h-7 w-full rounded border border-input bg-transparent px-2 py-1 text-xs',
            'file:border-0 file:bg-transparent file:text-xs file:font-medium',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          {...props}
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {reveal && (
            <button
              type="button"
              onClick={() => setIsRevealed(!isRevealed)}
              className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              {isRevealed ? (
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                </svg>
              ) : (
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          )}
          {copy && (
            <button
              type="button"
              onClick={() => {
                handleCopy().catch((error) => {
                  console.error('Failed to copy:', error);
                });
              }}
              className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied ? (
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

function base64URL(value: string) {
  return globalThis.btoa(value).replace(/[=]/g, '').replace(/[+]/g, '-').replace(/[\/]/g, '_');
}

/*
Convert a string into an ArrayBuffer
from https://developers.google.com/web/updates/2012/06/How-to-convert-ArrayBuffer-to-and-from-String
*/
function stringToArrayBuffer(value: string) {
  const buf = new ArrayBuffer(value.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0; i < value.length; i++) {
    bufView[i] = value.charCodeAt(i);
  }
  return buf;
}

function arrayBufferToString(buf: ArrayBuffer) {
  return String.fromCharCode.apply(null, Array.from(new Uint8Array(buf)));
}

const generateAppleSecretKey = async (
  kid: string,
  iss: string,
  sub: string,
  file: File
): Promise<{ kid: string, jwt: string, exp: number }> => {
  if (!kid) {
    const match = file.name.match(/AuthKey_([^.]+)[.].*$/i);
    if (match && match[1]) {
      kid = match[1];
    }
  }

  if (!kid) {
    throw new Error(
      `No Key ID provided. The file "${file.name}" does not follow the AuthKey_XXXXXXXXXX.p8 pattern. Please provide a Key ID manually.`
    );
  }

  const contents = await file.text();

  if (!contents.match(/^\s*-+BEGIN PRIVATE KEY-+[^-]+-+END PRIVATE KEY-+\s*$/i)) {
    throw new Error(`Chosen file does not appear to be a PEM encoded PKCS8 private key file.`);
  }

  // remove PEM headers and spaces
  const pkcs8 = stringToArrayBuffer(
    globalThis.atob(contents.replace(/-+[^-]+-+/g, '').replace(/\s+/g, ''))
  );

  const privateKey = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign']
  );

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 180 * 24 * 60 * 60;

  const jwt = [
    base64URL(JSON.stringify({ typ: 'JWT', kid, alg: 'ES256' })),
    base64URL(
      JSON.stringify({
        iss,
        sub,
        iat,
        exp,
        aud: 'https://appleid.apple.com',
      })
    ),
  ];

  const signature = await globalThis.crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: 'SHA-256',
    },
    privateKey,
    stringToArrayBuffer(jwt.join('.'))
  );

  jwt.push(base64URL(arrayBufferToString(signature)));

  return { kid, jwt: jwt.join('.'), exp };
};

const AppleSecretGenerator = () => {
  const [file, setFile] = useState<File | null>(null);
  const [teamID, setTeamID] = useState('');
  const [serviceID, setServiceID] = useState('');
  const [keyID, setKeyID] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');

  return (
    <div className="border border-input rounded-lg p-3 bg-background/50 space-y-3 max-w-xl">
      <Input
        label="Account ID"
        labelOptional="Found in the upper-right corner of Apple Developer Center."
        placeholder="Apple Developer account ID, 10 alphanumeric digits"
        value={teamID}
        onChange={(e) => setTeamID(e.target.value.trim())}
      />
      <Input
        label="Service ID"
        labelOptional="Found under Certificates, Identifiers & Profiles in Apple Developer Center."
        placeholder="ID of the service, example: com.example.app.service"
        value={serviceID}
        onChange={(e) => setServiceID(e.target.value.trim())}
      />
      <Input
        label="Key ID"
        labelOptional="Optional - extracted from filename or enter manually."
        placeholder="Extracted from filename, AuthKey_XXXXXXXXXX.p8"
        value={keyID}
        onChange={(e) => setKeyID(e.target.value.trim())}
      />
      <div className="space-y-1">
        <label className="text-xs font-medium leading-none text-gray-600 dark:text-gray-400">
          Private Key File (.p8)
        </label>
        <input
          type="file"
          accept=".p8"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
          }}
          className={cn(
            'flex h-7 w-full rounded border border-input bg-transparent px-2 py-1 text-xs',
            'file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        />
      </div>

      <Button
        color="primary"
        disabled={!(teamID.length === 10 && serviceID && file)}
        onClick={() => {
          (async () => {
            setError('');

            try {
              const { kid, jwt, exp } = await generateAppleSecretKey(
                keyID,
                teamID,
                serviceID,
                file!
              );
              setKeyID(kid);
              setSecretKey(jwt);
              setExpiresAt(new Date(exp * 1000).toString());
              setError('');
            } catch (e: unknown) {
              const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred';
              setError(errorMessage);
              console.error(e);
            }
          })().catch((error) => {
            console.error('Failed to generate secret:', error);
          });
        }}
        className="text-xs px-3 py-1.5"
      >
        Generate Secret Key
      </Button>

      {error && (
        <Info type="warning">
          {error}
        </Info>
      )}

      {secretKey && (
        <Input
          label="Secret Key"
          labelOptional={`Valid until: ${expiresAt}. Make sure you generate a new one before then!`}
          value={secretKey}
          reveal
          copy
          readOnly
        />
      )}
    </div>
  );
};

export default AppleSecretGenerator;
