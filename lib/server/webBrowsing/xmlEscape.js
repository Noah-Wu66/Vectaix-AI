function escapeMap(char) {
  switch (char) {
    case "&":
      return "&amp;";
    case "<":
      return "&lt;";
    case ">":
      return "&gt;";
    case '"':
      return "&quot;";
    case "'":
      return "&apos;";
    default:
      return char;
  }
}

export function escapeXmlAttr(value) {
  return String(value ?? "").replace(/[&<>"']/g, escapeMap);
}

export function escapeXmlContent(value) {
  return String(value ?? "").replace(/[&<>]/g, escapeMap);
}
