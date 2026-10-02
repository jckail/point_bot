import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { withinDeadline } from "../deadline";

const helperUrl = new URL("../deadline.ts", import.meta.url).href;

describe("assistant deadline work rejection handling", () => {
  it.each(["immediate", "late"])("handles %s work rejection after synchronous cancellation in strict Node mode", timing => {
    // A child process proves this does not merely pass because Vitest intercepts
    // unhandled rejections. No process-wide rejection listener hides a failure.
    const script = `
      import { withinDeadline } from ${JSON.stringify(helperUrl)};
      const controller = new AbortController();
      const cancellation = new Error("Synthetic cancellation");
      const work = (async () => {
        controller.abort(cancellation);
        ${timing === "late" ? "await new Promise(resolve => setImmediate(resolve));" : ""}
        throw new Error("Synthetic private adapter failure");
      })();
      let rejected = false;
      try { await withinDeadline(work, controller.signal); }
      catch (error) { rejected = error === cancellation; }
      if (!rejected) throw new Error("Deadline did not preserve cancellation");
      await new Promise(resolve => setTimeout(resolve, 20));
      process.stdout.write("cancelled without unhandled work rejection");
    `;
    const output = execFileSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf8", stdio: "pipe", timeout: 10_000 });
    expect(output).toBe("cancelled without unhandled work rejection");
  });

  it("returns completed work and preserves ordinary adapter rejection", async () => {
    const signal = new AbortController().signal;
    expect(await withinDeadline(Promise.resolve("ready"), signal)).toBe("ready");
    const failure = new Error("Synthetic adapter failure");
    await expect(withinDeadline(Promise.reject(failure), signal)).rejects.toBe(failure);
  });

  it("stops an already-observed pending operation without waiting for its late failure", async () => {
    const controller = new AbortController();
    let rejectWork!: (reason: Error) => void;
    const work = new Promise<never>((_resolve, reject) => { rejectWork = reject; });
    const result = withinDeadline(work, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow("Assistant deadline or cancellation");
    rejectWork(new Error("Synthetic late private failure"));
    // Allow promise handlers to settle; the caller need not wait for work.
    await new Promise<void>(resolve => setImmediate(resolve));
  });
});
