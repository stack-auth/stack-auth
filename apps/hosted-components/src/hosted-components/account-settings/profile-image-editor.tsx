import { Button, Avatar, AvatarFallback, AvatarImage } from "~/components/ui";

import { fileToBase64 } from '@hexclave/shared/dist/utils/base64';
import { runAsynchronouslyWithAlert } from '@hexclave/shared/dist/utils/promises';
import imageCompression from 'browser-image-compression';
import { UploadSimple, User } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import {
  getInsetPanelClassName,
  getOutlineButtonClassName,
  getPrimaryButtonClassName,
  useDesign,
} from "./design-context";

export async function checkImageUrl(url: string) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const buff = await res.blob();
    return buff.type.startsWith('image/');
  } catch {
    return false;
  }
}

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

export async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<string | null> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return null;
  }

  const safeCrop = {
    x: Math.max(0, pixelCrop.x),
    y: Math.max(0, pixelCrop.y),
    width: Math.max(1, pixelCrop.width),
    height: Math.max(1, pixelCrop.height),
  };

  canvas.width = safeCrop.width;
  canvas.height = safeCrop.height;

  ctx.drawImage(
    image,
    safeCrop.x,
    safeCrop.y,
    safeCrop.width,
    safeCrop.height,
    0,
    0,
    safeCrop.width,
    safeCrop.height
  );

  return canvas.toDataURL('image/jpeg');
}

export function ProfileImageEditor(props: {
  user: {
    profileImageUrl?: string | null;
    displayName?: string | null;
    primaryEmail?: string | null;
  },
  onProfileImageUrlChange: (profileImageUrl: string | null) => void | Promise<void>,
}) {
  const design = useDesign();
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  function reset() {
    setRawUrl(null);
    setError(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
  }

  const onCropChange = useCallback((crop: { x: number, y: number }) => {
    setCrop(crop);
  }, []);

  const onCropComplete = useCallback((croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const onZoomChange = useCallback((zoom: number) => {
    setZoom(zoom);
  }, []);

  function upload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      runAsynchronouslyWithAlert(async () => {
        const rawUrl = await fileToBase64(file);
        if (await checkImageUrl(rawUrl)) {
          setRawUrl(rawUrl);
          setError(null);
        } else {
          setError('Invalid image');
        }
        input.remove();
      });
    };
    input.click();
  }

  if (!rawUrl) {
    const initials = (props.user.displayName || props.user.primaryEmail || '')
      .slice(0, 2)
      .toUpperCase();

    return (
      <div className='flex flex-col gap-2'>
        <button type="button" className='relative group size-[60px] cursor-pointer overflow-hidden rounded-full p-0 text-left' onClick={upload}>
          <Avatar className="h-[60px] w-[60px] border border-black/[0.08] dark:border-white/[0.08]">
            <AvatarImage src={props.user.profileImageUrl || undefined} />
            <AvatarFallback className="bg-zinc-100 text-sm font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
              {initials || <User className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />}
            </AvatarFallback>
          </Avatar>
          <div className='pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/35 opacity-0 backdrop-blur-[2px] transition-opacity duration-150 group-hover:opacity-100'>
            <div className='rounded-full border border-black/[0.08] bg-background p-1.5 text-foreground dark:border-white/[0.10]'>
              <UploadSimple className='h-4 w-4 weight-bold' />
            </div>
          </div>
        </button>
        {error && <span className='text-red-500 dark:text-red-400 text-xs font-medium'>{error}</span>}
      </div>
    );
  }

  return (
    <div className='flex flex-col items-center gap-4 w-full max-w-xs'>
      <div className={getInsetPanelClassName(design, "relative w-64 h-64 overflow-hidden")}>
        <Cropper
          image={rawUrl || props.user.profileImageUrl || ""}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={onCropChange}
          onCropComplete={onCropComplete}
          onZoomChange={onZoomChange}
        />
      </div>

      <div className="w-full px-2 flex flex-col gap-1.5">
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Zoom</label>
        <input
          type="range"
          min={1}
          max={3}
          step={0.1}
          value={zoom}
          onChange={(e) => onZoomChange(parseFloat(e.target.value))}
          className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
        />
      </div>

      <div className='flex flex-row gap-2 w-full'>
        <Button
          onClick={async () => {
            if (rawUrl && croppedAreaPixels) {
              const croppedImageUrl = await getCroppedImg(rawUrl, croppedAreaPixels);
              if (croppedImageUrl) {
                const compressedFile = await imageCompression(
                  await imageCompression.getFilefromDataUrl(croppedImageUrl, 'profile-image'),
                  {
                    maxSizeMB: 0.1,
                    fileType: "image/jpeg",
                  }
                );
                const compressedUrl = await imageCompression.getDataUrlFromFile(compressedFile);
                await props.onProfileImageUrlChange(compressedUrl);
                reset();
              } else {
                setError('Could not crop image.');
              }
            }
          }}
          className={getPrimaryButtonClassName(design, "flex-1")}
        >
          Save
        </Button>
        <Button
          variant="outline"
          onClick={reset}
          className={getOutlineButtonClassName(design, "flex-1")}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
