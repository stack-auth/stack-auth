export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}

export function validateBase64Image(base64: string): boolean {
  const base64ImageRegex = /^data:image\/(png|jpg|jpeg|gif|bmp|webp);base64,[A-Za-z0-9+/]+={0,2}$|^[A-Za-z0-9+/]+={0,2}$/;
  return base64ImageRegex.test(base64);
}
import.meta.vitest?.test("validateBase64Image", ({ expect }) => {
  // Valid base64 image strings
  expect(validateBase64Image("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")).toBe(true);
  expect(validateBase64Image("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBA")).toBe(true);
  expect(validateBase64Image("ABC123")).toBe(true);
  // Invalid base64 image strings
  expect(validateBase64Image("data:text/plain;base64,SGVsbG8gV29ybGQ=")).toBe(false);
  expect(validateBase64Image("data:image/png;base64,invalid!base64")).toBe(false);
  expect(validateBase64Image("not a base64 string")).toBe(false);
  expect(validateBase64Image("")).toBe(false);
});
