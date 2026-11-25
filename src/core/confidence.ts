import type { Level, ReverseResult } from '../types';
import { accuracyLimitFor } from './choose-level';

export type Confidence = 'high' | 'medium' | 'low';

export interface AssessConfidenceOptions {
  readonly source: 'gps' | 'ip';
  readonly warnings: readonly string[];
  readonly reverse: ReverseResult;
  readonly level: Level;
}

export interface ConfidenceAssessment {
  readonly confidence: Confidence;
  readonly warnings: readonly string[];
}

const RANK: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 };

const cap = (current: Confidence, ceiling: Confidence): Confidence =>
  RANK[current] <= RANK[ceiling] ? current : ceiling;

export const assessConfidence = ({
  source,
  warnings,
  reverse,
  level,
}: AssessConfidenceOptions): ConfidenceAssessment => {
  if (source === 'ip') {
    return { confidence: 'low', warnings };
  }

  let confidence: Confidence = warnings.length === 0 ? 'high' : 'medium';
  const nextWarnings = [...warnings];
  const score = reverse.confidenceScore;

  if (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1) {
    if (score < 0.5) {
      confidence = cap(confidence, 'low');
      nextWarnings.push(`Provider match confidence is low (${score.toFixed(2)})`);
    } else if (score < 0.8) {
      confidence = cap(confidence, 'medium');
      nextWarnings.push(`Provider match confidence is moderate (${score.toFixed(2)})`);
    }
  }

  const distance = reverse.distanceMeters;
  const limit = accuracyLimitFor(level);

  if (
    typeof distance === 'number' &&
    Number.isFinite(distance) &&
    distance >= 0 &&
    Number.isFinite(limit)
  ) {
    if (distance > limit * 2) {
      confidence = cap(confidence, 'low');
      nextWarnings.push(
        `Provider match is ${Math.round(distance)}m from the requested point; confidence is low`,
      );
    } else if (distance > limit) {
      confidence = cap(confidence, 'medium');
      nextWarnings.push(`Provider match is ${Math.round(distance)}m from the requested point`);
    }
  }

  return { confidence, warnings: nextWarnings };
};
