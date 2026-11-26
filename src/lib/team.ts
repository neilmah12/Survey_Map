import type { Contact, Survey } from '../types';

/**
 * The Edmonton multifamily team, shown to clients under "Contact" and printed in the PDF report. These are the public
 * details from the team's web page. A survey chooses who appears (Survey.contactIds); with nothing chosen, everyone does.
 * To add or change a person, edit this list.
 */
export const TEAM: (Contact & { id: string })[] = [
  { id: 'amit-grover', name: 'Amit Grover', title: 'Principal', email: 'amit.grover@avisonyoung.com' },
  { id: 'jandip-deol', name: 'Jandip Deol', title: 'Principal', email: 'jandip.deol@avisonyoung.com' },
  { id: 'brandon-imada', name: 'Brandon Imada', title: 'Senior Vice President', email: 'brandon.imada@avisonyoung.com' },
  { id: 'tracy-olmos', name: 'Tracy Olmos', title: 'Associate', email: 'tracy.olmos@avisonyoung.com' },
  { id: 'brannon-guenette', name: 'Brannon Guenette', title: 'Client Services Coordinator', email: 'brannon.guenette@avisonyoung.com' },
  { id: 'neil-mah', name: 'Neil Mah', title: 'Analyst', email: 'neil.mah@avisonyoung.com' },
];

/** The team's page on Avison Young's market site, linked from the Contact card. */
export const TEAM_URL = 'https://avison-young-markets.foleon.com/edmonton/edmonton-multifamily/';

/** The people a survey shows: the ones chosen, in the team's order; everyone when nothing has been chosen. */
export function resolveContacts(survey: Pick<Survey, 'contactIds'>): Contact[] {
  const chosen = survey.contactIds;
  const list = chosen === undefined ? TEAM : TEAM.filter((p) => chosen.includes(p.id));
  return list.map(({ name, title, email }) => ({ name, title, email }));
}

/** One line per person for the PDF's contact box, then the web address. */
export function contactLines(contacts: Contact[], url: string): string {
  return [...contacts.map((c) => `${c.name}, ${c.title}: ${c.email}`), ...(url ? [`More from our team: ${url}`] : [])].join('\n');
}
