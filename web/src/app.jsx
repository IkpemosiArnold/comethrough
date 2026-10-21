import { useLocation, match } from './lib/router.js';
import { Toaster } from './ui/toast.jsx';
import { Sloth } from './ui/Sloth.jsx';
import { Start } from './screens/Start.jsx';
import { CrewGate } from './screens/CrewGate.jsx';
import { Join } from './screens/Join.jsx';
import { AddPlan } from './screens/AddPlan.jsx';
import { PlanPage } from './screens/PlanPage.jsx';
import { ShareTarget } from './screens/ShareTarget.jsx';
import { NotFound } from './screens/NotFound.jsx';

const ROUTES = [
  ['/', Start],
  ['/start', Start],
  ['/share', ShareTarget],
  ['/c/:slug', CrewGate],
  ['/c/:slug/join', Join],
  ['/c/:slug/add', AddPlan],
  ['/c/:slug/p/:id', PlanPage],
];

export function App() {
  const { path, query } = useLocation();
  let View = NotFound, params = {};
  for (const [pattern, C] of ROUTES) {
    const p = match(pattern, path);
    if (p) { View = C; params = p; break; }
  }
  return (
    <div class="app">
      <aside class="desk-aside" aria-hidden="true">
        <div class="desk-aside-inner">
          <Sloth size={150} />
          <p class="display display-xl painted">Come through</p>
          <p class="desk-tag">The group chat does the asking. You just come through.</p>
          <p class="desk-note">Made for phones. Send this page to yours, or keep going here.</p>
        </div>
      </aside>
      <main class="desk-main">
        <View key={path} params={params} query={query} />
      </main>
      <Toaster />
    </div>
  );
}
