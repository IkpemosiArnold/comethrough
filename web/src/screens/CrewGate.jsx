// /c/:slug decides: members see the crew, everyone else sees the join screen.
import { getCrew, saveCrew } from '../lib/store.js';
import { Join } from './Join.jsx';
import { CrewHome } from './CrewHome.jsx';

export function CrewGate({ params, query }) {
  const t = query.get('t');
  const m = query.get('m'); // a member's own link, e.g. opened on a second phone
  if (t) saveCrew(params.slug, { invite: t });
  if (m) saveCrew(params.slug, { memberToken: m });
  const mine = getCrew(params.slug);
  if (mine?.memberId || mine?.memberToken) return <CrewHome params={params} query={query} />;
  return <Join params={params} query={query} />;
}
