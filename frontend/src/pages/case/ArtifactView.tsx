import { Download } from "lucide-react";
import { artifactUrl, type Artifact, type ChartContent } from "@/lib/api";
import { ChartArtifact } from "@/components/charts";
import { cn } from "@/lib/utils";

function isChart(c: unknown): c is ChartContent {
  return !!c && typeof c === "object" && Array.isArray((c as ChartContent).data) && typeof (c as ChartContent).x === "string";
}

export function DiffView({ text }: { text: string }) {
  let oldNo = 0;
  let newNo = 0;
  return (
    <pre className="max-h-[420px] overflow-auto bg-bg py-1.5 font-mono text-[11.5px] leading-[19px]">
      {text.split("\n").map((l, i) => {
        const add = l.startsWith("+") && !l.startsWith("+++");
        const del = l.startsWith("-") && !l.startsWith("---");
        const hunk = l.startsWith("@@");
        const meta = l.startsWith("diff ") || l.startsWith("index ") || l.startsWith("+++") || l.startsWith("---");
        if (hunk) {
          const m = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);
          if (m) {
            oldNo = Number(m[1]);
            newNo = Number(m[2]);
          }
        }
        const left = meta || hunk ? "" : add ? "" : String(oldNo++);
        const right = meta || hunk ? "" : del ? "" : String(newNo++);
        return (
          <div
            key={i}
            className={cn(
              "grid grid-cols-[34px_34px_14px_1fr] pr-3",
              add && "bg-ok/[0.09]",
              del && "bg-bad/[0.09]",
              hunk && "bg-info/[0.07] text-info",
              meta && "text-faint",
            )}
          >
            <span className="select-none pr-2 text-right text-faint/70">{left}</span>
            <span className="select-none pr-2 text-right text-faint/70">{right}</span>
            <span className={cn("select-none", add ? "text-ok" : del ? "text-bad" : "text-faint")}>{add ? "+" : del ? "−" : ""}</span>
            <span className={cn("whitespace-pre", add && "text-ok", del && "text-bad")}>{add || del ? l.slice(1) || " " : l || " "}</span>
          </div>
        );
      })}
    </pre>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words bg-bg p-3 font-mono text-[11.5px] leading-[19px] text-muted">{children}</pre>;
}

export function ArtifactView({ artifact }: { artifact: Artifact }) {
  const { kind, content, path, name } = artifact;
  let body: React.ReactNode = null;
  if (kind === "chart" && isChart(content)) body = <div className="p-3"><ChartArtifact chart={content} /></div>;
  else if (kind === "diff" && typeof content === "string") body = <DiffView text={content} />;
  else if (content != null && (kind === "json" || typeof content === "object")) body = <Mono>{JSON.stringify(content, null, 2)}</Mono>;
  else if (content != null) body = <Mono>{String(content)}</Mono>;

  return (
    <div className="overflow-hidden rounded border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-raised px-3 py-2">
        <span className="rounded-sm border border-border px-1.5 text-[11px] font-bold uppercase text-muted">{kind}</span>
        <span className="truncate text-[12.5px] font-medium">{name}</span>
        {path && (
          <a href={artifactUrl(path)} target="_blank" rel="noreferrer" className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-accent hover:underline">
            <Download size={11} />
            Download
          </a>
        )}
      </div>
      {body}
      {!body && !path && <div className="px-3 py-2 font-mono text-2xs text-faint">No preview available.</div>}
    </div>
  );
}
