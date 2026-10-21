import { Sloth } from '../ui/Sloth.jsx';

export function NotFound() {
  return (
    <div class="column screen-enter empty-page">
      <Sloth size={110} />
      <h1 class="display display-lg">Nothing here</h1>
      <p class="muted">This link doesn't lead anywhere. If someone sent it to you, ask them for the crew link again.</p>
      <a class="btn primary" href="/">Start a crew</a>
    </div>
  );
}
