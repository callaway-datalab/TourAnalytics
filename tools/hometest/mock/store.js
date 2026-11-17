import { summary, PLAYERS } from "./fixture.js";
const S = summary();
export const watchAdminDatasets = (cb) => { setTimeout(() => cb([{ id: "ds1", columns: ["sg"], uploadedAt: { toMillis: () => 1 } }]), 0); return () => {}; };
export const watchClientDatasets = watchAdminDatasets;
export const getFieldStats = async () => S;
export const adminAllClients = async () => ({ labels: new Map(PLAYERS.map((p) => [p.key, p.name])) });
