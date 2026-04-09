import {
  type AttachmentAdapter,
  type CompleteAttachment,
  type PendingAttachment,
} from "@assistant-ui/react";
import {
  MAX_IMAGE_BYTES_PER_FILE,
  MAX_IMAGE_MB_PER_FILE,
} from "@stackframe/stack-shared/dist/ai/image-limits";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";

/** Chat composer attachments: UUID ids, shared max file size (see `image-limits`). */
export class ImageAttachmentAdapter implements AttachmentAdapter {
  public readonly accept = "image/*";

  public async add(state: { file: File }): Promise<PendingAttachment> {
    if (state.file.size > MAX_IMAGE_BYTES_PER_FILE) {
      throw new Error(
        `"${state.file.name}" is larger than ${MAX_IMAGE_MB_PER_FILE}MB.`,
      );
    }
    return {
      id: generateUuid(),
      type: "image",
      name: state.file.name,
      contentType: state.file.type,
      file: state.file,
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
