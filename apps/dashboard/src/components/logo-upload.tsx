"use client";

import { fileToBase64 } from '@stackframe/stack-shared/dist/utils/base64';
import { runAsynchronouslyWithAlert } from '@stackframe/stack-shared/dist/utils/promises';
import { Button, cn, Typography } from '@stackframe/stack-ui';
import imageCompression from 'browser-image-compression';
import { Upload, X } from 'lucide-react';
import { useState } from 'react';

export async function checkImageUrl(url: string) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const buff = await res.blob();
    return buff.type.startsWith('image/');
  } catch (e) {
    return false;
  }
}

export function LogoUpload(props: {
  label: string,
  value?: string | null,
  onValueChange: (value: string | null) => void | Promise<void>,
  description?: string,
  acceptedTypes?: string[],
  type: 'logo' | 'full-logo',
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function upload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = props.acceptedTypes?.join(',') || 'image/*';

    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setUploading(true);
      setError(null);

      runAsynchronouslyWithAlert(async () => {
        try {
          // Compress the image first
          const compressedFile = await imageCompression(file, {
            maxSizeMB: 1,
            maxWidthOrHeight: 800,
            useWebWorker: true,
            fileType: file.type.startsWith('image/svg') ? file.type : 'image/jpeg',
          });

          const base64Url = await fileToBase64(compressedFile);

          if (await checkImageUrl(base64Url)) {
            await props.onValueChange(base64Url);
            setError(null);
          } else {
            setError('Invalid image format');
          }
        } catch (err) {
          setError('Failed to process image');
          console.error('Logo upload error:', err);
        } finally {
          setUploading(false);
          input.remove();
        }
      });
    };

    input.click();
  }

  async function remove() {
    setError(null);
    await props.onValueChange(null);
  }

  const logoContainerClasses = props.type === 'full-logo'
    ? "relative h-16 w-48 rounded border overflow-hidden bg-muted"
    : "relative h-16 w-16 rounded border overflow-hidden bg-muted";

  const placeholderContainerClasses = props.type === 'full-logo'
    ? "h-16 w-48 rounded border-2 border-dashed border-muted-foreground/25 flex items-center justify-center bg-muted/50"
    : "h-16 w-16 rounded border-2 border-dashed border-muted-foreground/25 flex items-center justify-center bg-muted/50";

  return (
    <div className="flex flex-col gap-2">
      <Typography variant="secondary" type="label">
        {props.label}
      </Typography>

      <div className="flex items-center gap-3">
        {props.value ? (
          <div className="flex items-center gap-3">
            <div className={logoContainerClasses}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={props.value}
                alt={props.label}
                className="h-full w-full object-contain"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={remove}
              disabled={uploading}
            >
              <X className="h-4 w-4 mr-2" />
              Remove
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className={cn(placeholderContainerClasses, "cursor-pointer", uploading && "opacity-50 pointer-events-none")} onClick={uploading ? undefined : upload}>
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
            {props.description && (
              <Typography variant="secondary" type="footnote" className="mt-2">
                {props.description}
              </Typography>
            )}
          </div>
        )}
      </div>

      {error && (
        <Typography variant="destructive" type="footnote">
          {error}
        </Typography>
      )}
    </div>
  );
}
