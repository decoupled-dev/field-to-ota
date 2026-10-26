import { Download, FileText } from "lucide-react";
import { artifactUrl, type Artifact, type ChartContent } from "@/lib/api";
import { ChartArtifact } from "@/components/charts";
import { cn } from "@/lib/utils";

function isChart(c: unknown): c is ChartContent {
  return !!c && typeof c === "object" && Array.isArray((c as ChartContent).data) && typeof (c as ChartContent).x === "string";
}

export function DiffView({ text }: { text: string }) {
  return (
    <pre className="max-h-[420px] overflow-auto rounded border border-border bg-subtle/40 py-2 font-mono text-[12px] leading-5">
      {text.split("\n").map((l, i) => {
        const add = l.startsWith("+") && !l.startsWith("+++");
        const del = l.startsWith("-") && !l.startsWith("---");
        const hunk = l.startsWith("@@");
        const meta = l.startsWith("diff ") || l.startsWith("index ") || l.startsWith("+++") || l.startsWith("---");
        return (
          <div
            key={i}
            className={cn(
              "px-3",
              add && "bg-ok/10 text-ok",
              del && "bg-bad/10 text-bad",
              hunk && "bg-accent/5 text-accent",
              meta && "font-medium text-muted",
            )}
          >
            {l || " "}
          </div>
        );
      })}
    </pre>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-subtle/40 p-3 font-mono text-[12px] leading-5">{children}</pre>;
}

export function ArtifactView({ artifact }: { artifact: Artifact }) {
  const { kind, content, path, name } = artifact;
  let body: React.ReactNode = null;
  if (kind === "chart" && isChart(content)) body = <ChartArtifact chart={content} />;
  else if (kind === "diff" && typeof content === "string") body = <DiffView text={content} />;
  else if (content != null && (kind === "json" || typeof content === "object")) body = <Mono>{JSON.stringify(content, null, 2)}</Mono>;
  else if (content != null) body = <Mono>{String(content)}</Mono>;

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FileText size={14} className="text-muted" />
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="rounded bg-subtle px-1.5 py-px text-[11px] text-muted">{kind}</span>
        {path && (
          <a href={artifactUrl(path)} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            <Download size={12} />
            Download
          </a>
        )}
      </div>
      {body && <div className="p-3">{body}</div>}
      {!body && !path && <div className="px-3 py-2 text-xs text-muted">No preview available.</div>}
    </div>
  );
}
