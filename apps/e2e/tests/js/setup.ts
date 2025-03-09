// Mock window object for tests
import { vi } from 'vitest';

global.window = {
  location: {
    href: 'http://localhost:8100',
    origin: 'http://localhost:8100',
    assign: vi.fn(),
    replace: vi.fn(),
  },
  history: {
    replaceState: vi.fn(),
  },
} as any;
