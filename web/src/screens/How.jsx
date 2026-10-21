// How the sloth works: the one place with the full detail of what goes where.
import { TopBar } from '../ui/misc.jsx';
import { Sloth } from '../ui/Sloth.jsx';

export function How() {
  return (
    <div class="column screen-enter how-page">
      <TopBar backTo="/" title="How the sloth works" />
      <div class="how-sloth" aria-hidden="true"><Sloth size={84} mood="awake" /></div>
      <h1 class="display display-lg">How the sloth works</h1>
      <p class="lede">The sloth does the reading, picking and writing so nobody in the crew has to. It runs on open models and open data.</p>

      <section>
        <h2 class="section-label">What it reads, and where that goes</h2>
        <p>The sloth uses Gemma, Google's open model, through Google's free API. Google may use what it receives to improve its products. What goes to Gemma:</p>
        <ul class="how-list">
          <li>The sentence you type to start a crew.</li>
          <li>A plan you add: your sentence, the flyer picture, or the text of the link's page, with today's date.</li>
          <li>For the sloth's pick: the place, its kind, the weather, the crew's vibe words and the travel minutes from each neighbourhood.</li>
        </ul>
        <p>Your crew list, everyone's names and areas, and who is going stay with Come Through.</p>
      </section>

      <section>
        <h2 class="section-label">Maps, weather and rides</h2>
        <p>Places and maps come from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, found with Photon and Overpass, and road distances from OSRM. Weather comes from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0). Times to leave are estimates from the map, not live traffic.</p>
        <p>"Use my rough location" rounds your position to about a kilometre on your phone, and only the neighbourhood's name is kept.</p>
        <p>The mic uses your phone's own voice typing, which may send the audio to Google or Apple.</p>
      </section>

      <section>
        <h2 class="section-label">Run your own sloth</h2>
        <p>Come Through is <a href="https://github.com/IkpemosiArnold/comethrough" target="_blank" rel="noopener">open source</a> (MIT). Run your own copy with Gemma on your own computer through Ollama, and nothing goes to Google.</p>
      </section>
    </div>
  );
}
