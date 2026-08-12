/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Formats a duration in seconds as `m:ss`.
 * Extracted verbatim from interview.tsx.
 */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
