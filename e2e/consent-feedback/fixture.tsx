import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AgentsPanel,
  type ConsentRow,
} from "../../apps/web/src/components/agents-panel";
import { calls, settle } from "./actions";

window.fetch = async () => {
  throw new Error("Network disabled in synthetic fixture");
};

const row = (id: string, active: boolean): ConsentRow => ({
  id,
  providerId: "united-mileageplus",
  providerName: "United MileagePlus",
  active,
  expiresAt: new Date("2026-10-04T12:00:00Z"),
});

let update: ((next: (rows: ConsentRow[]) => ConsentRow[]) => void) | null = null;

function App() {
  const [consents, setConsents] = useState([row("fixture-consent-a", true)]);
  useEffect(() => {
    update = setConsents;
    return () => {
      if (update === setConsents) update = null;
    };
  }, []);
  return (
    <AgentsPanel
      tokens={[]}
      consents={consents}
      observations={[]}
      pendingReviews={[]}
      providers={[{ id: "united-mileageplus", name: "United MileagePlus" }]}
      mcpUrl="https://example.invalid/never-called"
    />
  );
}

const mount = document.getElementById("root");
if (!mount) throw new Error("Missing synthetic fixture root");
const root = createRoot(mount);
root.render(<StrictMode><App /></StrictMode>);

window.consentFixture = {
  calls,
  settle,
  grant(id) {
    if (!update) throw new Error("Unmounted");
    // Actual core renewal inserts a new grant ID and revokes old provider grants.
    update(rows => [...rows.map(item => ({ ...item, active: false })), row(id, true)]);
  },
  revoke(id) {
    if (!update) throw new Error("Unmounted");
    update(rows => rows.map(item => item.id === id ? { ...item, active: false } : item));
  },
  unmount() {
    root.unmount();
    update = null;
  },
};
