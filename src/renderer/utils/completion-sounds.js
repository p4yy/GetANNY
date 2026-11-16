import classic from "../assets/completion-chime.wav";
import gentle from "../assets/completion-gentle.wav";
import bright from "../assets/completion-bright.wav";
import double from "../assets/completion-double.wav";

const sounds = { classic, gentle, bright, double };

export function playCompletionSound(style = "classic", volume = 50) {
  try {
    const audio = new Audio(sounds[style] || classic);
    audio.volume = Math.max(0, Math.min(1, Number(volume ?? 50) / 100));
    audio.play().catch(() => {});
    return audio;
  } catch {
    return null;
  }
}
