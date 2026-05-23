import { compressImageFile } from "@/components/assistant-ui/compress-image";
import {
  type AttachmentAdapter,
  type CompleteAttachment,
  type PendingAttachment,
} from "@assistant-ui/react";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";

/** Chat composer attachments: UUID ids, auto-compressed to fit shared max file size (see `image-limits`). */
export class ImageAttachmentAdapter implements AttachmentAdapter {
  public readonly accept = "image/*";

  public async add(state: { file: File }): Promise<PendingAttachment> {
    const compressed = await compressImageFile(state.file);
    return {
      id: generateUuid(),
      type: "image",
      name: state.file.name,
      contentType: compressed.type,
      file: compressed,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  public async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const image = await readFileAsDataUrl(attachment.file);
    return {
      ...attachment,
      status: { type: "complete" },
      content: [{ type: "image", image }],
    };
  }

  public async remove(): Promise<void> {}
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
