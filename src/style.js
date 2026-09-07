const tones = {
  aqua: "\x1b[96m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  red: "\x1b[91m",
  blue: "\x1b[94m",
  dim: "\x1b[2m",
};

function enabled(stream) {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  return process.env.FORCE_COLOR === "1" || Boolean(stream?.isTTY);
}

export function color(text, tone, stream) {
  if (!enabled(stream)) {
    return text;
  }

  return `${tones[tone]}${text}\x1b[0m`;
}

export const aqua = (text, stream) => color(text, "aqua", stream);
export const green = (text, stream) => color(text, "green", stream);
export const yellow = (text, stream) => color(text, "yellow", stream);
export const red = (text, stream) => color(text, "red", stream);
export const blue = (text, stream) => color(text, "blue", stream);
export const dim = (text, stream) => color(text, "dim", stream);
