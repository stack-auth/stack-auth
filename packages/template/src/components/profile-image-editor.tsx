import { fileToBase64 } from '@stackframe/stack-shared/dist/utils/base64';
import { runAsynchronouslyWithAlert } from '@stackframe/stack-shared/dist/utils/promises';
import { Button, Slider, Typography } from '@stackframe/stack-ui';
import imageCompression from 'browser-image-compression';
import { Upload } from 'lucide-react';
import { ComponentProps, useCallback, useState } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import { useTranslation } from '../lib/translations';
import { UserAvatar } from './elements/user-avatar';

export async function checkImageUrl(url: string){
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const buff = await res.blob();
    return buff.type.startsWith('image/');
  } catch (e) {
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
  user: NonNullable<ComponentProps<typeof UserAvatar>['user']>,
  onProfileImageUrlChange: (profileImageUrl: string | null) => void | Promise<void>,
}) {
  const { t } = useTranslation();
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
          setError(t('Invalid image'));
        }
        input.remove();
      });
    };
    input.click();
  }

  if (!rawUrl) {
    return <div className='flex flex-col'>
      <div className='cursor-pointer relative' onClick={upload}>
        <UserAvatar
          size={60}
          user={props.user}
          border
        />
        <div className='absolute top-0 left-0 h-[60px] w-[60px] bg-gray-500/20 backdrop-blur-sm items-center justify-center rounded-full flex opacity-0 hover:opacity-100 transition-opacity'>
          <div className='bg-background p-2 rounded-full'>
            <Upload className='h-5 w-5' />
          </div>
        </div>
      </div>
      {error && <Typography variant='destructive' type='label'>{error}</Typography>}
    </div>;
  }

  return (
    <div className='flex flex-col items-center gap-4'>
      <div className='relative w-64 h-64'>
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
      <Slider
        min={1}
        max={3}
        step={0.1}
        value={[zoom]}
        onValueChange={(v) => onZoomChange(v[0])}
      />

      <div className='flex flex-row gap-2'>
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
                setError(t('Could not crop image.'));
              }
            }
          }}
        >
          {t('Save')}
        </Button>
        <Button
          variant="secondary"
          onClick={reset}
        >
          {t('Cancel')}
        </Button>
      </div>
    </div>
  );
}
