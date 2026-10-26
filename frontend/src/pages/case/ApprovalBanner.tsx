import { useState } from "react";
import { ShieldCheck } from "lucide-react";
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
    <div className="rounded-lg border border-warn/40 bg-warn/5">
      <div className="flex flex-wrap items-start gap-4 px-4 py-3">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Release approval required</div>
          <div className="mt-0.5 text-sm text-muted">{run.summary || "Review the evidence pack before the OTA is rolled out to the affected cohort."}</div>
          {evidence.length > 0 && (
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {evidence.map(([k, v]) => (
                <div key={k} className="flex gap-1.5">
                  <dt className="text-muted">{k.replace(/_/g, " ")}</dt>
                  <dd className="tnum font-medium">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a href={reportUrl(caseId, "evidence")} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost">Open evidence pack</Button>
          </a>
          <Button size="sm" variant="danger" onClick={() => setMode("reject")}>Reject</Button>
          <Button size="sm" variant="primary" onClick={() => setMode("approve")}>Approve release</Button>
        </div>
      </div>
      <Modal
        open={!!mode}
        onOpenChange={(o) => !o && setMode(null)}
        title={mode === "approve" ? "Approve OTA release" : "Reject release"}
        description={mode === "approve" ? "Your approval is recorded in the evidence pack and the release audit trail." : "The pipeline stops and the case returns to engineering."}
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="approver">Approver</Label>
            <Input id="approver" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Name, role" autoFocus />
          </div>
          <div>
            <Label htmlFor="comment">Comment</Label>
            <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={mode === "approve" ? "e.g. Evidence reviewed; canary first." : "Reason for rejection"} />
          </div>
          {err && <div className="text-xs text-bad">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
            <Button size="sm" variant={mode === "approve" ? "primary" : "danger"} disabled={busy || !approver.trim()} onClick={submit}>
              {mode === "approve" ? "Approve" : "Reject"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
