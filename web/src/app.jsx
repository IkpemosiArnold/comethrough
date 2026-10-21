import { useState } from 'preact/hooks';
import { useLocation, match } from './lib/router.js';
import { Toaster } from './ui/toast.jsx';
import { DataToggle } from './ui/DataToggle.jsx';
import { Sloth } from './ui/Sloth.jsx';
import { CrewGate, JoinRoute } from './screens/CrewGate.jsx';
import { getCrew, saveCrew } from './lib/store.js';
import { PlanPage } from './screens/PlanPage.jsx';
import { OneTapIn, OneTapMaybe } from './screens/OneTap.jsx';
import { NotFound } from './screens/NotFound.jsx';

// Screens only the organiser needs load on first use, so a friend arriving from WhatsApp
// downloads only the crew, the plan and the one-tap answer.
function lazy(load, name) {
  let C = null;
  let pending = null;
  return function Lazy(props) {
    const [, ready] = useState(0);
    if (C) return <C {...props} />;
    if (!pending) pending = load().then((m) => { C = m[name]; });
    pending.then(() => ready(1));
    return <div class="column" aria-busy="true" />;
  };
}
const Start = lazy(() => import('./screens/Start.jsx'), 'Start');
const AddPlan = lazy(() => import('./screens/AddPlan.jsx'), 'AddPlan');
const ShareTarget = lazy(() => import('./screens/ShareTarget.jsx'), 'ShareTarget');
const How = lazy(() => import('./screens/How.jsx'), 'How');

const ROUTES = [
  ['/', Start],
  ['/start', Start],
  ['/share', ShareTarget],
  ['/how', How],
  ['/c/:slug', CrewGate],
  ['/c/:slug/join', JoinRoute],
  ['/c/:slug/add', AddPlan],
  ['/c/:slug/p/:id', PlanPage],
  ['/c/:slug/p/:id/in', OneTapIn],
  ['/c/:slug/p/:id/maybe', OneTapMaybe],
];

export function App() {
  const { path, query } = useLocation();
  let View = NotFound, params = {};
  for (const [pattern, C] of ROUTES) {
    const p = match(pattern, path);
    if (p) { View = C; params = p; break; }
  }
  // Any crew link carries its key as ?t=: the crew's invite key, or a member's own. Keep it,
  // so a plan link opened on a new phone works and the name sheet can join with it.
  const t = query.get('t');
  if (params.slug && t && getCrew(params.slug)?.invite !== t && !getCrew(params.slug)?.memberToken) saveCrew(params.slug, { invite: t });
  return (
    <div class="app">
      <aside class="desk-aside" aria-hidden="true">
        <div class="desk-aside-inner">
          <Sloth size={150} />
          <p class="display display-xl painted">Come through</p>
          <p class="desk-tag">The lazy way to link up. You send one sentence, your crew taps once.</p>
          <p class="desk-note">Made for your phone. Open this link there, or carry on here.</p>
        </div>
      </aside>
      <main class="desk-main">
        <View key={path} params={params} query={query} />
      </main>
      <Toaster />
      <DataToggle />
    </div>
  );
}
