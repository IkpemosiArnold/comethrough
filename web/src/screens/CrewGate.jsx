// /c/:slug decides: members see the crew, everyone else sees the join screen.
import { getCrew, saveCrew } from '../lib/store.js';
import { Join } from './Join.jsx';
import { CrewHome } from './CrewHome.jsx';

export function CrewGate({ params, query }) {
  const t = query.get('t');
  if (t) saveCrew(params.slug, { invite: t });
  const mine = getCrew(params.slug);
  if (mine?.memberId) return <CrewHome params={params} query={query} />;
  return <Join params={params} query={query} />;
}
