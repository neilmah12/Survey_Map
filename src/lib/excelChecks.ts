import type { Survey } from '../types';
import type { Check } from './checks';
import { pendingEdits } from './exportXlsx';

/** Checks about the link between the app and the uploaded workbook. Slower (it re-reads the workbook), so run on demand. */
export async function excelChecks(survey: Survey): Promise<Check[]> {
  const out: Check[] = [];
  const appOnly = survey.buildings.filter((b) => b.addedInApp && b.units.every((u) => !u.srcRow));
  if (!survey.source) {
    out.push({ id: 'no-source', severity: 'info', group: 'Excel', title: 'No Excel workbook is stored with this survey', detail: 'Export Excel needs one. Use New from Excel to load it again.' });
    return out;
  }
  if (appOnly.length)
    out.push({ id: 'excel-new', severity: 'info', group: 'Excel', title: `${appOnly.length} building${appOnly.length === 1 ? '' : 's'} added in the app ${appOnly.length === 1 ? 'is' : 'are'} not in your Excel yet`, detail: `${appOnly.map((b) => b.name).join(', ')}. Export Excel adds them.` });
  const edits = await pendingEdits(survey);
  if (edits.length) {
    const names = [...new Set(edits.map((e) => e.building))];
    out.push({ id: 'excel-edits', severity: 'info', group: 'Excel', title: `${edits.length} edit${edits.length === 1 ? '' : 's'} made in the app ${edits.length === 1 ? 'is' : 'are'} not in your Excel yet`, detail: `${names.slice(0, 5).join(', ')}${names.length > 5 ? '...' : ''}. Export Excel writes them (cells with formulas are skipped). Updating from the sheet first would replace them.` });
  }
  return out;
}
