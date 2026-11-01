import type { HistoryItem } from '@/components/ui/history-list'

/** The card's conversations (components/HistoryList/preview.html), dated back from now. */
export function historyExamples(now: Date): HistoryItem[] {
  const ago = (days: number, hours = 0) =>
    Math.floor(now.getTime() / 1000) - days * 86_400 - hours * 3_600
  return [
    { id: 'diet', title: 'Is my diet good enough?', updatedAt: ago(0) },
    {
      id: 'goals',
      title: 'Am I doing enough to meet my goals this month?',
      updatedAt: ago(0, 0.1),
    },
    { id: 'knees', title: 'Why do my knees ache after squats?', updatedAt: ago(4) },
    { id: 'october', title: 'How steady was October?', updatedAt: ago(6) },
    { id: 'rest', title: 'Should I add a rest day?', updatedAt: ago(13) },
    { id: 'pull-ups', title: 'Is three times a week enough for pull-ups?', updatedAt: ago(20) },
  ]
}
