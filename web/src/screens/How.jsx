// How the sloth works: the one place with the full detail of what goes where. Every "How?"
// on the other screens opens this page.
import { TopBar } from '../ui/misc.jsx';
import { Sloth } from '../ui/Sloth.jsx';

export function How() {
  return (
    <div class="column screen-enter how-page">
      <TopBar backTo="/" title="" />
      <div class="how-sloth" aria-hidden="true"><Sloth size={84} mood="awake" /></div>
      <h1 class="display display-lg">How the sloth works</h1>
      <p class="lede">It reads, picks and writes, so nobody in the crew has to.</p>

      <section>
        <h2 class="section-label">What goes to Google</h2>
        <p>The sloth runs on Gemma, Google's open model, through Google's free API. Google may use what it gets to improve its products. It gets:</p>
        <ul class="how-list">
          <li>The sentence that starts a crew.</li>
          <li>A plan you add: the sentence, the flyer or the link's page, with today's date.</li>
          <li>For a pick: the place, the weather, the crew's vibe and the travel times.</li>
        </ul>
        <p>Names, areas and who is going stay with Come Through.</p>
      </section>

      <section>
        <h2 class="section-label">Maps, weather and rides</h2>
        <p>Places and maps are © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, found with Photon and Overpass, with road times from OSRM. Weather is from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0). Times to leave are map estimates, not live traffic.</p>
        <p>Your rough location is rounded to about 1 km on your phone, and only the area's name is kept. The mic uses your phone's voice typing, which may send audio to Google or Apple.</p>
      </section>

      <section>
        <h2 class="section-label">Run your own</h2>
        <p>Come Through is <a href="https://github.com/IkpemosiArnold/comethrough" target="_blank" rel="noopener">open source</a> (MIT). Run it with Gemma on your own computer through Ollama, and nothing goes to Google.</p>
      </section>
    </div>
  );
}
