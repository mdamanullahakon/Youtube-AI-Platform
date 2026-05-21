import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../../services/circuit-breaker.service';

describe('CircuitBreaker', () => {
  it('rejects when the wrapped call exceeds the configured timeout', async () => {
    const breaker = new CircuitBreaker({
      name: 'timeout-test',
      timeout: 10,
      volumeThreshold: 1,
      errorThresholdPercentage: 1,
    });

    await expect(
      breaker.call(
        () => new Promise(resolve => setTimeout(() => resolve('late'), 50)),
      ),
    ).rejects.toThrow('timed out after 10ms');

    expect(breaker.getStats().failures).toBe(1);
    expect(breaker.getState()).toBe('open');
  });
});
