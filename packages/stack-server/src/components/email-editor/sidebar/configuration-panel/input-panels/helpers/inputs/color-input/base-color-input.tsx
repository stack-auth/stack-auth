import { Label } from '@/components/ui/label';
import { CircleSlash, Plus } from 'lucide-react';
import React, { useState } from 'react';
import { HexColorInput, HexColorPicker } from 'react-colorful';

type Props =
  | {
      nullable: true,
      label: string,
      onChange: (value: string | null) => void,
      defaultValue: string | null,
    }
  | {
      nullable: false,
      label: string,
      onChange: (value: string) => void,
      defaultValue: string,
    };

export default function ColorInput({ label, defaultValue, onChange, nullable }: Props) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [value, setValue] = useState(defaultValue);
  const handleClickOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const renderResetButton = () => {
    if (!nullable) {
      return null;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }
    return (
      <button
        onClick={() => {
          setValue(null);
          onChange(null);
        }}
        className="flex items-center justify-center p-1"
      >
        <CircleSlash className='h-4 w-4' />
      </button>
    );
  };

  const renderOpenButton = () => {
    if (value) {
      return (
        <button
          onClick={handleClickOpen}
          className="border border-cadet-400 w-8 min-w-8 h-8 rounded bg-white"
          style={{ backgroundColor: value }}
        />
      );
    }
    return (
      <button
        onClick={handleClickOpen}
        className="border border-cadet-400 w-8 min-w-8 h-8rounded bg-white flex items-center justify-center"
      >
        <Plus className='h-4 w-4' />
      </button>
    );
  };

  return (
    <div className="flex flex-col items-start">
      <Label className="mb-2">{label}</Label>
      <div className="flex space-x-2">
        {renderOpenButton()}
        <HexColorInput
          prefixed
          color={value || ''}
          onChange={onChange}
          className="p-1 border rounded w-full text-sm"
        />
        {renderResetButton()}
      </div>
      {anchorEl && (
        <div
          className="absolute z-10 mt-2 w-64 bg-white border border-gray-300 rounded-lg shadow-lg"
          onMouseLeave={() => setAnchorEl(null)}
        >
          <div className="space-y-4 p-4">
            <HexColorPicker
              color={value || ''}
              onChange={(v) => {
                setValue(v);
                onChange(v);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
