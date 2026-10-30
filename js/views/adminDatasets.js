import { el, mount, formatWhen, num, confirmAction, subNav } from "../ui.js";
import { watchAdminDatasets, uploadDataset, deleteDataset, uploadErrorMessage, adminAllClients, publishFieldStats, watchImports, deleteImport } from "../store.js";
import { detectColumns, isShotData, prepare, buildFieldSummary } from "../sg.js";
import { parseCsv, tableFromCsvRows, buildDataset } from "../data.js";

export async function render(main, { flash }) {
  const file = el("input", { type: "file", accept: ".csv,.parquet", required: true });
  const idColumn = el("input", { value: "playerID", required: true });
  const description = el("input", { maxLength: 200 });
  const submit = el("button", { class: "btn", type: "submit" }, "Upload data");
  const listBox = el("div");
  const importsBox = el("section", { class: "py-imports", hidden: true });

  const form = el("form", {
    class: "stack narrow",
    onSubmit: async (e) => {
      e.preventDefault();
      const f = file.files[0];
      if (!f) { flash("Choose a CSV or Parquet file.", "error"); return; }
      const ext = f.name.toLowerCase().split(".").pop();
      if (!["csv", "parquet"].includes(ext)) { flash("Data files must be .csv or .parquet.", "error"); return; }

      // A browser can't hold a CSV much over ~400 MB as text, and the whole file is read in one go.
      const MB = 1024 * 1024;
      if (ext === "csv" && f.size > 400 * MB) { flash(`That CSV is ${Math.round(f.size / MB).toLocaleString()} MB. A browser can only read CSVs up to about 400 MB. Save it as Parquet (much smaller), or split it (by year, say) and upload the parts.`, "error"); return; }
      if (ext === "parquet" && f.size > 300 * MB) { flash(`That Parquet file is ${Math.round(f.size / MB).toLocaleString()} MB, more than this page can read in one go (about 300 MB). Split it (by year, say) and upload the parts.`, "error"); return; }
      submit.disabled = true; submit.textContent = "Reading file\u2026";
      try {
        let table;
        if (ext === "csv") {
          table = tableFromCsvRows(parseCsv(await f.text()));
        } else {
          const { readParquetFile } = await import("../parquet.js");
          table = await readParquetFile(f);
        }
        const dataset = buildDataset(table, idColumn.value.trim() || "playerID");
        table = null;
        submit.textContent = `Uploading (${dataset.byClient.size} people)\u2026`;
        // Named after the file; uploading a file with the same name replaces that data.
        const displayName = f.name.replace(/\.(csv|parquet)$/i, "");
        const people = dataset.byClient.size;
        const result = await uploadDataset(displayName, description.value.trim(), dataset, (done, total) => {
          submit.textContent = `Uploading (${people} people)\u2026 ${Math.min(99, Math.round((done / total) * 100))}%`;
        });

        // Strokes-gained files: the rankings and the lie / distance detail. (update 403) Built in the cloud from the rows
        // just saved (the data-import function), not in this tab: on a big file that ran the page out of memory.
        const idx = detectColumns(dataset.columns);
        let rebuildNote = "";
        if (isShotData(idx)) {
          submit.textContent = "Asking the cloud to update the rankings\u2026";
          try { const { requestRebuild } = await import("../fieldStore.js"); await requestRebuild(result.datasetId, displayName); rebuildNote = " The rankings are updating in the cloud (shown above); players see them in a few minutes."; }
          catch (err) {
            console.warn("Couldn't ask the cloud to rebuild; building here instead", err);
            // (the Storage rules from before update 403: built here as before, if this computer can)
            try {
              const { labels } = await adminAllClients();
              const players = [...dataset.byClient].map(([key, g]) => ({ key, name: labels.get(key) || g.name || g.label, rounds: prepare(g.rows, idx) }));
              await publishFieldStats(result.datasetId, buildFieldSummary(players), Date.now());
              const { publishFieldDetail } = await import("../fieldStore.js");
              await publishFieldDetail(result.datasetId, players, Date.now());
            } catch (err2) { console.error("Couldn't publish rankings", err2); rebuildNote = " The rankings couldn\u2019t be updated: republish the Storage rules (update 403), then use Rebuild rankings below."; }
          }
        }

        let msg = `Added "${displayName}": ${num(dataset.rowCount)} rows for ${num(result.clients)} ${result.clients === 1 ? "person" : "people"}.${rebuildNote}`;
        if (dataset.blankIdRows) msg += ` ${num(dataset.blankIdRows)} rows have no value in "${dataset.idColumn}" and won't be shown to anyone.`;
        flash(msg, "ok");
        form.reset(); idColumn.value = "playerID";
      } catch (err) {
        flash(uploadErrorMessage(err, "that data file"), "error");
      } finally {
        submit.disabled = false; submit.textContent = "Upload data";
      }
    },
  }, [
    el("label", {}, ["File (.csv or .parquet)", file,
      el("small", {}, "Columns: player, playerID, year, date, tournament, round, category, distance, lie, stat (or stat type), stat value, attempts, tour, and optionally successes. Stat is \u201cStrokes Gained\u201d (the value per attempt) or any other stat (Hit Green %, GIR %, Proximity (ft), Birdies/Round \u2026). Every stat in the file appears in the Stats page\u2019s Stat Type list. Leave category, distance and lie empty where a stat doesn\u2019t have them, and round empty for a row that covers a whole tournament.")]),
    el("label", {}, ["Column that says who each row belongs to", idColumn,
      el("small", {}, "Usually playerID. Each player's rows are matched by this ID; a player column, if the file has one, gives their name. Matching ignores capital letters and spaces.")]),
    el("label", {}, ["Short description (optional)", description]),
    el("div", {}, submit),
  ]);

  mount(main, [
    subNav([["#/admin/clients", "Users"], ["#/admin/datasets", "Upload Data"]], "#/admin/datasets"),
    el("p", { class: "muted intro" }, "Upload one file that covers many people. Each person only sees the rows that belong to them."),
    el("section", {}, [el("h2", {}, "Upload a data file"), form]),
    importsBox,
    el("section", {}, [el("h2", {}, "Uploaded files"), listBox]),
  ]);

  // files sent from Python (tour_upload.py -> the data-import function): progress and result (update 146)
  let importsList = [], fileIds = null;
  const drawImports = () => {
    // only uploads still in progress, ones that failed, and ones whose data file is still here
    const list = importsList.filter((x) => x.status !== "done" || !fileIds || fileIds.has(x.datasetId));
    importsBox.hidden = !list.length;
    if (!list.length) { mount(importsBox, null); return; }
    mount(importsBox, [
      el("h2", {}, "From Python"),
      el("ul", { class: "py-list" }, list.map((x0) => {
        // (update 165) no heartbeat for 15 minutes: the cloud stopped it (time or memory), so say so
        const beat = x0.updatedAt?.toMillis?.() ?? x0.startedAt?.toMillis?.() ?? 0;
        const x = x0.status === "running" && beat && Date.now() - beat > 15 * 60 * 1000
          ? { ...x0, status: "error", stopped: true, message: x0.rows || /^rebuild_/.test(x0.id || "") ? "Stopped while updating the rankings (the rows are live). Use Rebuild rankings below to try again." : "Stopped: the cloud ran out of time or memory reading a file this big. Send it again with tour_upload.py from update 165, which splits it on your computer first." }
          : x0;
        const state = x.status === "done" ? el("span", { class: "py-ok" }, "Live")
          : x.status === "error" ? el("span", { class: "py-err" }, x.stopped ? "Stopped" : "Failed")
          : el("span", { class: "py-run" }, x.step ? `${x.step}\u2026` : "Working\u2026");
        // (update 408) a "Rebuild rankings" run has no rows of its own: say what it did
        const detail = x.status === "done" ? (x.rows == null ? `Rankings rebuilt${x.people ? ` for ${num(x.people)} players` : ""}` : `${num(x.rows)} rows for ${num(x.people)} ${x.people === 1 ? "person" : "people"}${x.blankIdRows ? ` \u00b7 ${num(x.blankIdRows)} rows had no ID` : ""}${x.rankings === false ? "" : " \u00b7 rankings updated"}`)
          : x.status === "error" ? x.message || "" : x.rows ? `${num(x.rows)} rows for ${num(x.people)} people` : "";
        const x2 = el("button", { type: "button", class: "link py-x", title: "Clear from this list", "aria-label": `Clear ${x.name || x.file} from this list` }, "\u2715");
        x2.addEventListener("click", async () => { x2.disabled = true; try { await deleteImport(x.id); } catch { x2.disabled = false; flash("Couldn't clear it. Republish the Firestore rules (update 146).", "error"); } });
        return el("li", {}, [
          el("div", { class: "py-top" }, [el("strong", {}, x.name || x.file), el("span", { class: "py-right" }, [state, x2])]),
          el("p", { class: "muted small" }, [detail, detail ? " \u00b7 " : "", formatWhen(x.finishedAt || x.startedAt)]),
        ]);
      })),
    ]);
  };
  const unsubImports = watchImports((list) => { importsList = list; drawImports(); });

  const unsub = watchAdminDatasets((datasets) => {
    fileIds = new Set(datasets.map((d) => d.id)); drawImports();
    if (!datasets.length) { mount(listBox, el("p", { class: "empty" }, "Nothing uploaded yet.")); return; }
    const table = el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, ["Name", "ID column", "Rows", "People", "Uploaded", ""].map((h, i) =>
        el("th", { class: i === 2 || i === 3 ? "num" : null }, h)))),
      el("tbody", {}, datasets.map((d) => {
        const del = el("button", { class: "link danger", type: "button" }, "Delete");
        del.addEventListener("click", async () => {
          if (!confirmAction(`Delete "${d.name}"? Clients will lose access to it.`)) return;
          del.disabled = true; del.textContent = "Deleting\u2026";
          try { await deleteDataset(d.id); import("../fieldStore.js").then((m) => m.deleteFieldDetail(d.id)).catch(() => {}); flash(`Deleted "${d.name}".`, "ok"); }
          catch { flash("Couldn't delete that dataset.", "error"); del.disabled = false; del.textContent = "Delete"; }
        });
        // (update 403) the rankings and detail, rebuilt in the cloud from the saved rows (nothing heavy in this tab)
        const reb = isShotData(detectColumns(d.columns || [])) ? el("button", { class: "link", type: "button", title: "Rebuild the rankings and the lie / distance detail in the cloud" }, "Rebuild rankings") : null;
        reb?.addEventListener("click", async () => {
          reb.disabled = true; reb.textContent = "Asking\u2026";
          try { const { requestRebuild } = await import("../fieldStore.js"); await requestRebuild(d.id, d.name); flash(`Rebuilding the rankings for "${d.name}" in the cloud. Progress shows above; it takes a few minutes.`, "ok"); }
          catch (err) { console.error(err); flash("Couldn\u2019t ask the cloud to rebuild. Republish the Storage rules (update 403) and try again.", "error"); }
          finally { reb.disabled = false; reb.textContent = "Rebuild rankings"; }
        });
        return el("tr", {}, [
          el("td", {}, el("strong", {}, d.name)), el("td", {}, d.idColumn),
          el("td", { class: "num" }, num(d.rowCount)), el("td", { class: "num" }, num((d.clientKeys || []).length)),
          el("td", {}, [formatWhen(d.uploadedAt), d.source === "python" ? el("span", { class: "py-tag" }, "Python") : null]), el("td", { class: "actions" }, [reb, reb ? " " : null, del]),
        ]);
      })),
    ]);
    mount(listBox, el("div", { class: "table-scroll" }, table));
  });
  return () => { unsub(); unsubImports(); };
}
