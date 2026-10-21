// What leaves the phone, said once at the point of sending, with the detail one tap away.

/** One line at the point of sending, and the detail one tap away. */
export function Privacy({ what, mic = false }) {
  return (
    <details class="privacy">
      <summary>Gemma, Google's open model, reads {what}. Only that goes to Google. <span class="privacy-more">What goes where</span></summary>
      <p>Come Through sends it to Gemma through Google's free API, and Google may use it to improve its products. Your crew list, names and locations stay with Come Through.{mic ? " The mic uses your phone's own voice typing, which may send the audio to Google or Apple." : ''}</p>
      <p>Want to run your own sloth? Come Through is open source and can use Gemma on your own computer through Ollama, and then nothing goes to Google.</p>
    </details>
  );
}
