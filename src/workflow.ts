import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runRound, type AppEnv, type Steps } from "./game";

export class RoundWorkflow extends WorkflowEntrypoint<AppEnv, { jobId: string }> {
  async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep): Promise<void> {
    const steps: Steps = {
      do: <T>(name: string, fn: () => Promise<T>) =>
        step.do(name, { retries: { limit: 2, delay: "5 seconds", backoff: "constant" }, timeout: "5 minutes" }, fn as () => Promise<never>) as Promise<T>,
      sleep: (name, ms) => step.sleep(name, ms),
    };
    await runRound(this.env, event.payload.jobId, steps, `workflow:${event.payload.jobId}`);
  }
}
