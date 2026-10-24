// ESM like providerHttpErrors.js: imported by the renderer (read aloud playback
// pipelines one chunk while the previous one plays) and loaded by the main
// process through require(esm) (Google's endpoint takes at most 100 characters
// per request). Pure on purpose so both sides split text the same way.

// A sentence ends at . ! ? or … followed by closing quotes or brackets.
const SENTENCE_PATTERN = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g;

// Cuts one piece no longer than maxChars: after the last clause punctuation
// that fits, else at the last space, else mid-word.
function fitPiece(piece, maxChars) {
  const parts = [];
  let rest = piece;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    const clauseEnd = Math.max(
      window.lastIndexOf(", "),
      window.lastIndexOf("; "),
      window.lastIndexOf(": "),
      window.lastIndexOf(" — ")
    );
    let cut = clauseEnd > 0 ? clauseEnd + 1 : window.lastIndexOf(" ");
    if (cut <= 0) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Splits text into chunks of at most maxChars, packing whole sentences
 * together and breaking a sentence only when it alone is too long.
 * Whitespace runs collapse to one space.
 */
export function splitReadAloudText(text, maxChars) {
  const clean = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!clean) return [];
  const pieces = (clean.match(SENTENCE_PATTERN) ?? [clean])
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .flatMap((sentence) => fitPiece(sentence, maxChars));

  const chunks = [];
  let current = "";
  for (const piece of pieces) {
    if (!current) {
      current = piece;
    } else if (current.length + 1 + piece.length <= maxChars) {
      current += ` ${piece}`;
    } else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
