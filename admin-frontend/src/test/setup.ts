import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Explicit, rather than relying on @testing-library/react's auto-cleanup
// detection - without this, multiple tests in one file that each call
// render() leave prior renders' DOM (and their <input type="file"> etc.)
// behind, and a document.querySelectorAll() in a later test can silently
// pick up a stale element from an earlier test instead of its own.
afterEach(() => cleanup());

// jsdom has no ResizeObserver - recharts' <ResponsiveContainer> (used by
// Donut/LineChartCard/HorizontalBarChart on Analytics) needs one to measure
// its parent. A no-op stub is enough for component tests, which only need
// the chart to render without throwing, not to actually be sized.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);
