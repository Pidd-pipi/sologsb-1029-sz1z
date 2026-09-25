import { reactive, watch } from 'vue';
import { createInitialState } from './data';
import type { Lesson, PersistedState, PracticeAttempt, SentenceAttempt, SentenceRetry } from './types';
import { isMastered, isPerfectScore, MAX_SENTENCE_RETRIES, needsConsolidation, scoreSentence } from './utils';

const STORAGE_KEY = 'sologsb-1029-dictation-state-v1';

/** 兼容旧版本本地数据：补齐逐句重练字段并升级 schema 版本。 */
function normalizeState(stored: Partial<PersistedState>): PersistedState {
  const attempts = (stored.attempts ?? []).map((attempt) => ({
    ...attempt,
    sentenceAttempts: (attempt.sentenceAttempts ?? []).map((sentence) => ({
      ...sentence,
      retries: sentence.retries ?? []
    }))
  })) as PracticeAttempt[];
  return {
    ...createInitialState(),
    ...stored,
    schemaVersion: 2,
    attempts
  } as PersistedState;
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const version: number | undefined = parsed.schemaVersion;
      if (version === 1 || version === 2) return normalizeState(parsed);
    }
  } catch {
    // Falls back to the sample course when the local draft is malformed.
  }
  return createInitialState();
}

export const state = reactive<PersistedState>(loadState());

export const persist = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
};

watch(state, persist, { deep: true });

export const lessons = (): Lesson[] => state.courses.flatMap((course) => course.lessons);
export const lessonById = (id: string): Lesson | undefined => lessons().find((lesson) => lesson.id === id);
export const courseForLesson = (lessonId: string) => state.courses.find((course) => course.id === lessonById(lessonId)?.courseId);

export function setDownloaded(lessonId: string, value: boolean) {
  const lesson = lessonById(lessonId);
  if (lesson) lesson.downloaded = value;
}

export function saveAttempt(attempt: PracticeAttempt) {
  state.attempts.unshift(attempt);
}

/** 课程列表取该课最近一次提交，统计其中仍待巩固的句子数。 */
export function latestAttemptForLesson(lessonId: string): PracticeAttempt | undefined {
  return state.attempts.find((attempt) => attempt.lessonId === lessonId);
}

export function pendingSentenceCount(lessonId: string): number {
  return latestAttemptForLesson(lessonId)?.sentenceAttempts.filter(needsConsolidation).length ?? 0;
}

/**
 * 在某次已提交作答内对单句发起重练。仅写入该句的重练记录，
 * 不改动原课程成绩与教师反馈；只保留最近三次（新到旧）。
 */
export function addSentenceRetry(attemptId: string, sentenceId: string, answer: string): SentenceRetry | undefined {
  const sentence = state.attempts
    .find((attempt) => attempt.id === attemptId)
    ?.sentenceAttempts.find((item) => item.sentenceId === sentenceId);
  if (!sentence) return undefined;
  const { tokens, score } = scoreSentence(sentence.source, answer);
  const retry: SentenceRetry = {
    id: `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: sentence.source,
    answer,
    tokens,
    score,
    retriedAt: new Date().toISOString()
  };
  sentence.retries = [retry, ...sentence.retries].slice(0, MAX_SENTENCE_RETRIES);
  return retry;
}

export function updateTokenClassification(attemptId: string, sentenceId: string, tokenIndex: number, patch: { category?: SentenceAttempt['tokens'][number]['category']; reason?: string }) {
  const attempt = state.attempts.find((item) => item.id === attemptId);
  const token = attempt?.sentenceAttempts.find((item) => item.sentenceId === sentenceId)?.tokens.find((item) => item.index === tokenIndex);
  if (token) Object.assign(token, patch);
}

export function exportRecords(): string {
  const sentenceMastery = state.attempts.flatMap((attempt) => attempt.sentenceAttempts.map((sentence) => {
    const mastered = isMastered(sentence.retries);
    const pending = !mastered && (sentence.retries.length > 0 || !isPerfectScore(sentence.score));
    return {
      attemptId: attempt.id,
      lessonId: attempt.lessonId,
      lessonTitle: attempt.lessonTitle,
      sentenceId: sentence.sentenceId,
      originalScore: sentence.score,
      status: mastered ? 'mastered' : pending ? 'pending' : 'untracked',
      retryCount: sentence.retries.length,
      // 重练明细按新到旧排列，完整记录同样嵌在各 sentenceAttempt.retries 内。
      retries: sentence.retries
    };
  }));
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    application: 'EchoStep 移动听写',
    attempts: state.attempts,
    sentenceMastery,
    progress: state.progress
  }, null, 2);
}

export function resetDemo() {
  const fresh = createInitialState();
  Object.assign(state, fresh);
}
