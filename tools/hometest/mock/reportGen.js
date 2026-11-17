import { fullRounds } from "./fixture.js";
export async function loadSource(src, k) { return { me: { rounds: fullRounds(k) } }; }
