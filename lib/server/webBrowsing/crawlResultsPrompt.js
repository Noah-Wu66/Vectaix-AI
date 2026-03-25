import { escapeXmlAttr, escapeXmlContent } from "@/lib/server/webBrowsing/xmlEscape";

export function crawlResultsPrompt(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "<no_crawl_results />";
  }

  const items = results
    .map((item) => {
      if (item?.errorMessage) {
        const attrs = [
          `errorType="${escapeXmlAttr(item.errorType || "FetchError")}"`,
          `errorMessage="${escapeXmlAttr(item.errorMessage)}"`,
        ];

        if (item?.url) {
          attrs.push(`url="${escapeXmlAttr(item.url)}"`);
        }

        return `  <error ${attrs.join(" ")} />`;
      }

      const attrs = [`url="${escapeXmlAttr(item?.url || "")}"`];

      if (item?.title) attrs.push(`title="${escapeXmlAttr(item.title)}"`);
      if (item?.contentType) attrs.push(`contentType="${escapeXmlAttr(item.contentType)}"`);
      if (item?.description) attrs.push(`description="${escapeXmlAttr(item.description)}"`);
      if (Number.isFinite(item?.length)) attrs.push(`length="${item.length}"`);

      const attrString = attrs.join(" ");
      const content = item?.content ? escapeXmlContent(item.content) : "";
      return content
        ? `  <page ${attrString}>${content}</page>`
        : `  <page ${attrString} />`;
    })
    .join("\n");

  return `<crawlResults>\n${items}\n</crawlResults>`;
}
