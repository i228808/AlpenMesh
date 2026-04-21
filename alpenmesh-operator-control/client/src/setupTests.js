import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

if (!global.TextEncoder) {
  global.TextEncoder = TextEncoder;
}
if (!global.TextDecoder) {
  global.TextDecoder = TextDecoder;
}

// Stub media playback for jsdom
Object.defineProperty(global.HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: jest.fn().mockResolvedValue(),
});
Object.defineProperty(global.HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  value: jest.fn(),
});
