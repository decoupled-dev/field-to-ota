import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api, reportUrl, type StageRun } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/sheet";

export function ApprovalBanner({ caseId, run, onDone }: { caseId: string; run: StageRun; onDone: () => void }) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [approver, setApprover] = useState(() => {
    try {
      return localStorage.getItem("f2f-approver") ?? "";
    } catch {
      return "";
    }
  });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!mode || !approver.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      try {
        localStorage.setItem("f2f-approver", approver.trim());
      } catch {
        /* storage unavailable */
      }
      await (mode === "approve" ? api.approve : api.reject)(caseId, approver.trim(), comment.trim());
      setMode(null);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const evidence = Object.entries(run.inputs ?? {}).slice(0, 6);

  return (
    <div className="relative overflow-hidden rounded-md border border-warn/45 bg-warn/[0.06]">
      <div className="hazard absolute inset-y-0 left-0 w-2 opacity-80" />
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 py-4 pl-7 pr-4">
        <div className="min-w-0 flex-1">
          <div className="label flex items-center gap-2 text-warn">
            <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-warn" />
            Release gate · human approval required
          </div>
          <div className="mt-1.5 text-[16px] font-semibold tracking-tight">Sign off the OTA before it reaches the fleet</div>
          <div className="mt-1 max-w-3xl text-[13px] leading-5 text-muted">{run.summary || "Review the evidence pack before the OTA is rolled out to the affected cohort."}</div>
          {evidence.length > 0 && (
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
              {evidence.map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-2">
                  <dt className="text-xs text-faint">{k.replace(/_/g, " ")}</dt>
                  <dd className="tnum font-mono text-[12px] text-fg">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a href={reportUrl(caseId, "evidence")} target="_blank" rel="noreferrer">
            <Button size="md" variant="secondary">Evidence pack <ArrowUpRight size={13} /></Button>
          </a>
          <Button size="md" variant="danger" onClick={() => setMode("reject")}>Reject</Button>
          <Button size="md" variant="primary" onClick={() => setMode("approve")}>Approve release</Button>
        </div>
      </div>
      <Modal
        open={!!mode}
        onOpenChange={(o) => !o && setMode(null)}
        title={mode === "approve" ? "Approve OTA release" : "Reject release"}
        description={mode === "approve" ? "Your approval is recorded in the evidence pack and the release audit trail." : "The pipeline stops and the case returns to engineering."}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="approver">Approver</Label>
            <Input id="approver" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Name, role" autoFocus />
          </div>
          <div>
            <Label htmlFor="comment">Comment</Label>
            <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={mode === "approve" ? "e.g. Evidence reviewed; canary first." : "Reason for rejection"} />
          </div>
          {err && <div className="font-mono text-2xs text-bad">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
            <Button size="sm" variant={mode === "approve" ? "primary" : "danger"} disabled={busy || !approver.trim()} onClick={submit}>
              {mode === "approve" ? "Approve & release" : "Reject"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
