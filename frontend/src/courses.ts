export const courseColors = ['green', 'blue', 'rose', 'amber'] as const;
export type CourseColor = (typeof courseColors)[number];
export interface Course {
  id: string;
  name: string;
  description: string;
  tags: string[];
  color: CourseColor;
  createdAt: string;
  updatedAt: string;
}
export type CourseInput = Pick<Course, 'name' | 'description' | 'tags' | 'color'>;
const storageKey = 'course-replay.local-courses.v1';

function isCourse(value: unknown): value is Course {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === 'string' && typeof c.name === 'string' &&
    typeof c.description === 'string' && Array.isArray(c.tags) &&
    c.tags.every(tag => typeof tag === 'string') &&
    courseColors.includes(c.color as CourseColor) &&
    typeof c.createdAt === 'string' && Number.isFinite(Date.parse(c.createdAt)) &&
    typeof c.updatedAt === 'string' && Number.isFinite(Date.parse(c.updatedAt));
}

export function readCourses(): Course[] {
  const raw = localStorage.getItem(storageKey);
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(isCourse)) {
    throw new Error('课程数据格式无法识别，原有数据已保留。');
  }
  return parsed;
}

export function saveCourses(courses: Course[]) {
  localStorage.setItem(storageKey, JSON.stringify(courses));
}
