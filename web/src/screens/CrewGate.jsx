// /c/:slug is the crew page for everyone with the link: members and guests alike. A guest
// sees the plans first, and is asked for a name only at their first "I'm going" or "Join".
// /c/:slug/join (older links, and the basic pages' next step) opens the same page with the
// name already being asked.
import { saveCrew } from '../lib/store.js';
import { CrewHome } from './CrewHome.jsx';

export function CrewGate({ params, query }) {
  const m = query.get('m'); // a member's own link, e.g. opened on a second phone
  if (m) saveCrew(params.slug, { memberToken: m });
  return <CrewHome params={params} query={query} />;
}

export function JoinRoute({ params, query }) {
  return <CrewHome params={params} query={query} askName />;
}
