export class ImageProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

export async function parseBase64Image(input: string, options: {
  maxBytes?: number,
  maxWidth?: number,
  maxHeight?: number,
  allowTypes?: string[],
} = {
  maxBytes: 1_000_000, // 1MB
  maxWidth: 4096,
  maxHeight: 4096,
  allowTypes: ['image/jpeg', 'image/png', 'image/webp'],
}) {
  // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
  const base64Data = input.replace(/^data:image\/[a-zA-Z0-9]+;base64,/, '');

  // check the size before and after the base64 conversion
  if (base64Data.length > options.maxBytes!) {
    throw new ImageProcessingError(`Image size (${base64Data.length} bytes) exceeds maximum allowed size (${options.maxBytes} bytes)`);
  }

  // Convert base64 to buffer
  let imageBuffer: Buffer;
  try {
    imageBuffer = Buffer.from(base64Data, 'base64');
  } catch (error) {
    throw new ImageProcessingError('Invalid base64 image data');
  }

  // Check file size
  if (options.maxBytes && imageBuffer.length > options.maxBytes) {
    throw new ImageProcessingError(`Image size (${imageBuffer.length} bytes) exceeds maximum allowed size (${options.maxBytes} bytes)`);
  }

  // Dynamically import sharp
  const sharp = (await import('sharp')).default;

  // Use Sharp to load image and get metadata
  let sharpImage: any;
  let metadata: any;

  try {
    sharpImage = sharp(imageBuffer);
    metadata = await sharpImage.metadata();
  } catch (error) {
    throw new ImageProcessingError('Invalid image format or corrupted image data');
  }

  // Validate image format
  if (!metadata.format) {
    throw new ImageProcessingError('Unable to determine image format');
  }

  const mimeType = `image/${metadata.format}`;
  if (options.allowTypes && !options.allowTypes.includes(mimeType)) {
    throw new ImageProcessingError(`Image type ${mimeType} is not allowed. Allowed types: ${options.allowTypes.join(', ')}`);
  }

  if (!metadata.width || !metadata.height) {
    throw new ImageProcessingError('Unable to determine image dimensions');
  }

  if (options.maxWidth && metadata.width > options.maxWidth) {
    throw new ImageProcessingError(`Image width (${metadata.width}px) exceeds maximum allowed width (${options.maxWidth}px)`);
  }

  if (options.maxHeight && metadata.height > options.maxHeight) {
    throw new ImageProcessingError(`Image height (${metadata.height}px) exceeds maximum allowed height (${options.maxHeight}px)`);
  }

  // Return the validated image data and metadata
  return {
    buffer: imageBuffer,
    metadata: {
      format: metadata.format,
      mimeType,
      width: metadata.width,
      height: metadata.height,
      size: imageBuffer.length,
      channels: metadata.channels,
      density: metadata.density,
      hasProfile: metadata.hasProfile,
      hasAlpha: metadata.hasAlpha,
    },
    sharp: sharpImage,
  };
}
