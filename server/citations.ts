type Citation = {
  type: string;
  url?: string;
  title?: string;
  filename?: string;
  file_id?: string;
  index?: number;
  start_index?: number;
  end_index?: number;
};

type TextPart = { type: string; text?: string; annotations?: Citation[] };
type OutputItem = { type: string; content?: TextPart[] };

function citationLink(citation: Citation): string | undefined {
  let href: string;
  let label: string;
  if (citation.type === "url_citation" && citation.url) {
    try {
      const url = new URL(citation.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") return;
      href = url.href;
      label = citation.title || url.hostname;
    } catch {
      return;
    }
  } else if (citation.type === "file_citation" && citation.file_id) {
    href = `/api/files/${encodeURIComponent(citation.file_id)}/content`;
    label = citation.filename || "Source document";
  } else {
    return;
  }
  const escapedLabel = label.replace(/\s+/g, " ").replace(/[\\`*_[\]<>]/g, "\\$&");
  return `[${escapedLabel}](<${href.replace(/</g, "%3C").replace(/>/g, "%3E")}>)`;
}

export function formatCitations(text: string, annotations: Citation[] = []): string {
  const markers = [...text.matchAll(/\u3010(\d+):(\d+)\u2020[^\u3011]*\u3011/g)];
  const edits: { start: number; end: number; replacement: string }[] = [];
  const linkedMarkers = new Set<number>();

  for (const citation of annotations) {
    const link = citationLink(citation);
    if (!link) continue;
    const hasRange = Number.isInteger(citation.start_index) && Number.isInteger(citation.end_index)
      && citation.start_index! >= 0 && citation.end_index! >= citation.start_index!
      && citation.end_index! <= text.length;
    const matchingMarkers = markers.filter((marker) => hasRange
      ? marker.index >= citation.start_index! && marker.index + marker[0].length <= citation.end_index!
      : citation.type === "file_citation" && Number(marker[2]) === citation.index);

    for (const marker of matchingMarkers) {
      if (linkedMarkers.has(marker.index)) continue;
      edits.push({ start: marker.index, end: marker.index + marker[0].length, replacement: ` ${link}` });
      linkedMarkers.add(marker.index);
    }
    if (matchingMarkers.length === 0) {
      const position = hasRange ? citation.end_index! : text.length;
      edits.push({ start: position, end: position, replacement: ` ${link}` });
    }
  }

  for (const marker of markers) {
    if (!linkedMarkers.has(marker.index)) {
      edits.push({ start: marker.index, end: marker.index + marker[0].length, replacement: " [Source unavailable]" });
    }
  }

  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  }
  return text;
}

export function formatResponse(output: OutputItem[], fallback: string): string {
  const parts = output.filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string");
  return parts.length ? parts.map((part) => formatCitations(part.text!, part.annotations)).join("\n\n")
    : formatCitations(fallback);
}