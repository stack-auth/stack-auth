import { fileToBase64 } from '@stackframe/stack-shared/dist/utils/base64';
import { runAsynchronouslyWithAlert } from '@stackframe/stack-shared/dist/utils/promises';
import { Button, Slider, Typography } from '@stackframe/stack-ui';
import imageCompression from 'browser-image-compression';
import { Upload } from 'lucide-react';
import { ComponentProps, useRef, useState } from 'react';
import AvatarEditor from 'react-avatar-editor';
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

export function ProfileImageEditor(props: {
  user: NonNullable<ComponentProps<typeof UserAvatar>['user']>,
  onProfileImageUrlChange: (profileImageUrl: string | null) => void | Promise<void>,
}) {
  const { t } = useTranslation();
  const cropRef = useRef<AvatarEditor>(null);
  const [slideValue, setSlideValue] = useState(1);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSlideValue(1);
    setRawUrl(null);
    setError(null);
  }

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
      <AvatarEditor
        ref={cropRef}
        image={rawUrl || props.user.profileImageUrl || ""}
        borderRadius={1000}
        color={[0, 0, 0, 0.72]}
        scale={slideValue}
        rotate={0}
        border={20}
        className='border'
      />
      <Slider
        min={1}
        max={5}
        step={0.1}
        defaultValue={[slideValue]}
        value={[slideValue]}
        onValueChange={(v) => setSlideValue(v[0])}
      />

      <div className='flex flex-row gap-2'>
        <Button
          onClick={async () => {
            if (cropRef.current && rawUrl) {
              const croppedUrl = cropRef.current.getImage().toDataURL('image/jpeg');
              const compressedFile = await imageCompression(
                await imageCompression.getFilefromDataUrl(croppedUrl, 'profile-image'),
                {
                  maxSizeMB: 0.1,
                  fileType: "image/jpeg",
                }
              );
              const compressedUrl = await imageCompression.getDataUrlFromFile(compressedFile);
              await props.onProfileImageUrlChange(compressedUrl);
              reset();
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
