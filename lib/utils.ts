import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Standard shadcn/21st helper: merge conditional classes without Tailwind conflicts.
 * Components copied from 21st.dev (or `npx shadcn add https://21st.dev/r/...`) import
 * `cn` from `@/lib/utils`, so this file is what makes those snippets drop in unchanged.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
