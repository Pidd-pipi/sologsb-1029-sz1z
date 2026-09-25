import type { SentenceAttempt, TextSegment, TokenResult } from './types';

/** 每句保留的重练次数上限（新到旧排列）。 */
export const MAX_SENTENCE_RETRIES = 3;

/** 单句满分阈值：逐词全部正确才算满分。 */
export const isPerfectScore = (score: number): boolean => score >= 100;

/** 单句评分，沿用提交时的逐词比对规则。 */
export function scoreSentence(source: string, answer: string): Pick<SentenceAttempt, 'tokens' | 'score'> {
  const tokens = compareSentence(source, answer);
  const correct = tokens.filter((token) => token.correct).length;
  return { tokens, score: tokens.length ? Math.round((correct / tokens.length) * 100) : 0 };
}

export const segmentText = (text: string): TextSegment[] => {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]+/gu) ?? [];
  return matches.map((display, index) => ({
    index,
    display,
    normalized: normalizeToken(display)
  }));
};

export const normalizeToken = (token: string): string => token
  .toLocaleLowerCase('en')
  .replaceAll('’', "'")
  .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

export function compareSentence(expected: string, answer: string): TokenResult[] {
  const expectedTokens = segmentText(expected);
  const actualTokens = segmentText(answer);
  const rows = expectedTokens.length + actualTokens.length;
  const table = Array.from({ length: rows + 1 }, () => Array<number>(rows + 1).fill(0));
  const move = Array.from({ length: rows + 1 }, () => Array<string>(rows + 1).fill(''));

  for (let i = 0; i <= expectedTokens.length; i += 1) {
    table[i][0] = i;
    move[i][0] = 'delete';
  }
  for (let j = 0; j <= actualTokens.length; j += 1) {
    table[0][j] = j;
    move[0][j] = 'insert';
  }

  for (let i = 1; i <= expectedTokens.length; i += 1) {
    for (let j = 1; j <= actualTokens.length; j += 1) {
      const substitution = table[i - 1][j - 1] + (expectedTokens[i - 1].normalized === actualTokens[j - 1].normalized ? 0 : 1);
      const deletion = table[i - 1][j] + 1;
      const insertion = table[i][j - 1] + 1;
      table[i][j] = Math.min(substitution, deletion, insertion);
      move[i][j] = substitution <= deletion && substitution <= insertion
        ? 'match'
        : deletion <= insertion ? 'delete' : 'insert';
    }
  }

  const reversed: TokenResult[] = [];
  let i = expectedTokens.length;
  let j = actualTokens.length;
  while (i > 0 || j > 0) {
    const direction = move[i][j];
    if (direction === 'match' && i > 0 && j > 0) {
      const expectedToken = expectedTokens[i - 1];
      const actualToken = actualTokens[j - 1];
      const correct = expectedToken.normalized === actualToken.normalized;
      reversed.push({
        index: i - 1,
        expected: expectedToken.display,
        actual: actualToken.display,
        correct,
        category: correct ? 'unclassified' : 'spelling',
        reason: ''
      });
      i -= 1;
      j -= 1;
    } else if (direction === 'delete' && i > 0) {
      reversed.push({ index: i - 1, expected: expectedTokens[i - 1].display, actual: '', correct: false, category: 'omitted', reason: '' });
      i -= 1;
    } else if (j > 0) {
      reversed.push({ index: Math.max(0, i - 1), expected: '', actual: actualTokens[j - 1].display, correct: false, category: 'extra', reason: '' });
      j -= 1;
    } else {
      break;
    }
  }

  const result = reversed.reverse();
  return result.map((token, index) => ({ ...token, index }));
}

/**
 * 连续两次重练满分才视为已掌握：重练记录按新到旧排列，
 * 因此最近两次即数组前两位；最近一次低于满分立即回到待巩固。
 */
export function isMastered(retries: SentenceAttempt['retries']): boolean {
  return retries.length >= 2 && isPerfectScore(retries[0].score) && isPerfectScore(retries[1].score);
}

/**
 * 是否需要巩固：已掌握的句子不再计入；其余只要开始过重练、
 * 或原课程提交时该句未满分，都属于待巩固。
 */
export function needsConsolidation(sentenceAttempt: SentenceAttempt): boolean {
  if (isMastered(sentenceAttempt.retries)) return false;
  return sentenceAttempt.retries.length > 0 || !isPerfectScore(sentenceAttempt.score);
}

export function scoreAttempt(sentenceAttempts: SentenceAttempt[]): number {
  const totals = sentenceAttempts.flatMap((attempt) => attempt.tokens);
  if (!totals.length) return 0;
  const correct = totals.filter((token) => token.correct).length;
  return Math.max(0, Math.round((correct / totals.length) * 100));
}
