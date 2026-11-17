import { COURSE } from "./fixture.js";
export async function listHeatCourses() { return [COURSE]; } export async function heatData() { const holes = {}; COURSE.par.forEach((p, i) => { holes[String(i + 1)] = { par: p, yards: p * 110, pins: {} }; }); return { holes }; }
export async function heatImage() { const s = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="420"><rect width="900" height="420" fill="#1a1a1a"/><path d="M40 360 Q450 120 860 60 L880 120 Q450 220 60 400Z" fill="#4a7a2a"/></svg>`; return "data:image/svg+xml," + encodeURIComponent(s); }
export const lieName = (s) => s; export const pinLabel = () => "Back Center";
