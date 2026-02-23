import { BaseStrategy } from './base-strategy.js';
import { StickyStrategy } from './sticky-strategy.js';
import { RoundRobinStrategy } from './round-robin-strategy.js';

export { BaseStrategy, StickyStrategy, RoundRobinStrategy };

export const DEFAULT_STRATEGY = 'sticky';

export const STRATEGIES = {
  STICKY: 'sticky',
  ROUND_ROBIN: 'round-robin',
};

const strategyMap = {
  sticky: StickyStrategy,
  'round-robin': RoundRobinStrategy,
};

const strategyLabels = {
  sticky: 'Sticky (Cache-Optimized)',
  'round-robin': 'Round-Robin (Load-Balanced)',
};

export function createStrategy(name, config) {
  const StrategyClass = strategyMap[name] || StickyStrategy;
  return new StrategyClass(config);
}

export function getStrategyLabel(name) {
  return strategyLabels[name] || strategyLabels[DEFAULT_STRATEGY];
}
