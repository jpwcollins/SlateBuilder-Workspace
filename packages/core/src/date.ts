export function getBlockMinutes(date: Date): number {
  const day = date.getDay(); // 0 Sun, 1 Mon, 4 Thu
  const isThursday = day === 4;
  if (isThursday) {
    const occurrence = getWeekdayOccurrenceInMonth(date);
    if (occurrence === 2 || occurrence === 4) {
      return 420; // 09:00-16:00
    }
  }
  return 480; // 08:00-16:00
}

export function getBlockStartMinutes(date: Date): number {
  const day = date.getDay();
  const isThursday = day === 4;
  if (isThursday) {
    const occurrence = getWeekdayOccurrenceInMonth(date);
    if (occurrence === 2 || occurrence === 4) {
      return 9 * 60;
    }
  }
  return 8 * 60;
}

export function formatMinutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `${hh}${mm}`;
}

export function normalizeDateOnly(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 10);
}

export function isAvailableOnDate(unavailableUntil: string | undefined, date: Date): boolean {
  const normalized = normalizeDateOnly(unavailableUntil);
  if (!normalized) return true;
  const dateOnly = date.toISOString().slice(0, 10);
  return normalized <= dateOnly;
}

function getWeekdayOccurrenceInMonth(date: Date): number {
  const dayOfWeek = date.getDay();
  const dayOfMonth = date.getDate();
  let count = 0;
  for (let d = 1; d <= dayOfMonth; d += 1) {
    const current = new Date(date.getFullYear(), date.getMonth(), d);
    if (current.getDay() === dayOfWeek) {
      count += 1;
    }
  }
  return count;
}
