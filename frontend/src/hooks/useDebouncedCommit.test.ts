import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedCommit } from './useDebouncedCommit';

describe('useDebouncedCommit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('commits once after the pause and keeps edits made while a commit lands', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(({ value }) => useDebouncedCommit(value, commit, 250), {
      initialProps: { value: 24 },
    });
    act(() => result.current[1](25));
    act(() => result.current[1](26));
    act(() => vi.advanceTimersByTime(250));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith(26);

    act(() => result.current[1](27)); // user keeps going before the URL update arrives
    rerender({ value: 26 }); // our own commit lands
    expect(result.current[0]).toBe(27); // not snapped back
    act(() => vi.advanceTimersByTime(250));
    expect(commit).toHaveBeenLastCalledWith(27);
  });

  it('follows external URL changes such as back navigation', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(({ value }) => useDebouncedCommit(value, commit, 250), {
      initialProps: { value: 24 },
    });
    rerender({ value: 12 });
    expect(result.current[0]).toBe(12);
    act(() => vi.advanceTimersByTime(500));
    expect(commit).not.toHaveBeenCalled();
  });
});
