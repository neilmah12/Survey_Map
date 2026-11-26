/**
 * A file name that reads like a person named it: the survey's own title with its spaces, and a short label.
 * "SE/SW New Build Townhomes" becomes "SE-SW New Build Townhomes - Rental Market Survey.pdf". Only the characters a
 * file name cannot hold are replaced.
 */
export function fileLabel(title: string): string {
  const t = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .slice(0, 110)
    .trim();
  return t || 'Rental Market Survey';
}

export const fileName = (title: string, label: string, ext: string): string => `${fileLabel(title)} - ${label}.${ext}`;
