'use client';


//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY, INSTEAD EDIT THE CORRESPONDING FILE IN packages/template
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
