import { reactive, watch } from 'vue';
import { createInitialState } from './data';
import type { Lesson, PersistedState, PracticeAttempt, SentenceRepractice } from './types';
import { sentenceMastery } from './utils';

const STORAGE_KEY = 'sologsb-1029-dictation-state-v1';
const MAX_REPRACTICES_PER_SENTENCE = 3;

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState & { schemaVersion: number };
      if (parsed.schemaVersion === 2) return parsed;
      if (parsed.schemaVersion === 1) {
        // v1 → v2: sentence repractice tracking was added; existing
        // attempts, progress and settings carry over untouched.
        return { ...parsed, schemaVersion: 2, repractices: parsed.repractices ?? {} };
      }
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

// Repractices live outside the attempt so the original lesson score and
// teacher feedback are never modified; only the latest few are kept,
// newest first.
export function saveRepractice(record: SentenceRepractice) {
  const history = state.repractices[record.sentenceId] ?? [];
  state.repractices[record.sentenceId] = [record, ...history].slice(0, MAX_REPRACTICES_PER_SENTENCE);
}

export function repracticesFor(sentenceId: string): SentenceRepractice[] {
  return state.repractices[sentenceId] ?? [];
}

export function lessonNeedsWorkCount(lessonId: string): number {
  const lesson = lessonById(lessonId);
  if (!lesson) return 0;
  return lesson.sentences.filter((sentence) => sentenceMastery(repracticesFor(sentence.id)) === 'needsWork').length;
}

export function updateTokenClassification(attemptId: string, sentenceId: string, tokenIndex: number, patch: { category?: PracticeAttempt['sentenceAttempts'][number]['tokens'][number]['category']; reason?: string }) {
  const attempt = state.attempts.find((item) => item.id === attemptId);
  const token = attempt?.sentenceAttempts.find((item) => item.sentenceId === sentenceId)?.tokens.find((item) => item.index === tokenIndex);
  if (token) Object.assign(token, patch);
}

export function exportRecords(): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    application: 'EchoStep 移动听写',
    attempts: state.attempts,
    repractices: state.repractices,
    mastery: Object.fromEntries(
      Object.entries(state.repractices).map(([sentenceId, records]) => [
        sentenceId,
        {
          status: sentenceMastery(records),
          recentScores: records.map((record) => record.score),
          lastPracticedAt: records[0]?.practicedAt ?? null
        }
      ])
    ),
    progress: state.progress
  }, null, 2);
}

export function resetDemo() {
  const fresh = createInitialState();
  Object.assign(state, fresh);
}
