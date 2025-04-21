'use client';


//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================

export function FormWarningText({ text }: { text?: string }) {
  if (!text) {
    return null;
  }
  return (
    <div className="text-red-500 text-sm mt-1">
      {text}
    </div>
  );
}
