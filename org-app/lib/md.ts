/** Egyszerű, biztonságos markdown-részhalmaz → HTML.
 *  Támogatás: # ## ### címsorok, - listák, **félkövér**, *dőlt*, bekezdések. */
export function mdToHtml(src: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => s
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>");
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const raw of esc(src).split(/\r?\n/)) {
    const l = raw.trimEnd();
    if (/^###\s+/.test(l)) { closeList(); out.push(`<h4>${inline(l.replace(/^###\s+/, ""))}</h4>`); }
    else if (/^##\s+/.test(l)) { closeList(); out.push(`<h3>${inline(l.replace(/^##\s+/, ""))}</h3>`); }
    else if (/^#\s+/.test(l)) { closeList(); out.push(`<h2>${inline(l.replace(/^#\s+/, ""))}</h2>`); }
    else if (/^[-*]\s+/.test(l)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(l.replace(/^[-*]\s+/, ""))}</li>`);
    }
    else if (l === "") closeList();
    else { closeList(); out.push(`<p>${inline(l)}</p>`); }
  }
  closeList();
  return out.join("\n");
}
