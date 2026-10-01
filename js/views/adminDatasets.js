import { el, mount, formatWhen, num, confirmAction, subNav } from "../ui.js";
import { watchAdminDatasets, uploadDataset, deleteDataset, uploadErrorMessage, adminAllClients, publishFieldStats } from "../store.js";
import { detectColumns, isShotData, prepare, buildFieldSummary } from "../sg.js";
import { parseCsv, tableFromCsvRows, buildDataset } from "../data.js";

export async function render(main, { flash }) {
  const file = el("input", { type: "file", accept: ".csv,.parquet", required: true });
  const idColumn = el("input", { value: "playerID", required: true });
  const description = el("input", { maxLength: 200 });
  const submit = el("button", { class: "btn", type: "submit" }, "Upload data");
  const listBox = el("div");

  const form = el("form", {
    class: "stack narrow",
    onSubmit: async (e) => {
      e.preventDefault();
      const f = file.files[0];
      if (!f) { flash("Choose a CSV or Parquet file.", "error"); return; }
      const ext = f.name.toLowerCase().split(".").pop();
      if (!["csv", "parquet"].includes(ext)) { flash("Data files must be .csv or .parquet.", "error"); return; }

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
        submit.textContent = `Uploading (${dataset.byClient.size} people)\u2026`;
        // Named after the file; uploading a file with the same name replaces that data.
        const displayName = f.name.replace(/\.(csv|parquet)$/i, "");
        const people = dataset.byClient.size;
        const result = await uploadDataset(displayName, description.value.trim(), dataset, (done, total) => {
          submit.textContent = `Uploading (${people} people)\u2026 ${Math.min(99, Math.round((done / total) * 100))}%`;
        });

        // Strokes-gained files: publish the per-round summary players' rankings are built from.
        const idx = detectColumns(dataset.columns);
        if (isShotData(idx)) {
          submit.textContent = "Updating rankings\u2026";
          try {
            const { labels } = await adminAllClients();
            const players = [...dataset.byClient].map(([key, g]) => ({ key, name: labels.get(key) || g.name || g.label, rounds: prepare(g.rows, idx) }));
            await publishFieldStats(result.datasetId, buildFieldSummary(players), Date.now());
          } catch (err) { console.error("Couldn't publish rankings", err); }
        }

        let msg = `Added "${displayName}": ${num(dataset.rowCount)} rows for ${num(result.clients)} ${result.clients === 1 ? "person" : "people"}.`;
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
    el("label", {}, ["File (.csv or .parquet)", file]),
    el("label", {}, ["Column that says who each row belongs to", idColumn,
      el("small", {}, "Usually playerID. Each player's rows are matched by this ID; a player column, if the file has one, gives their name. Matching ignores capital letters and spaces.")]),
    el("label", {}, ["Short description (optional)", description]),
    el("div", {}, submit),
  ]);

  mount(main, [
    subNav([["#/admin/analyze", "Analyze"], ["#/admin/datasets", "Upload"]], "#/admin/datasets"),
    el("p", { class: "muted intro" }, "Upload one file that covers many people. Each person only sees the rows that belong to them."),
    el("section", {}, [el("h2", {}, "Upload a data file"), form]),
    el("section", {}, [el("h2", {}, "Uploaded files"), listBox]),
  ]);

  const unsub = watchAdminDatasets((datasets) => {
    if (!datasets.length) { mount(listBox, el("p", { class: "empty" }, "Nothing uploaded yet.")); return; }
    const table = el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, ["Name", "ID column", "Rows", "People", "Uploaded", ""].map((h, i) =>
        el("th", { class: i === 2 || i === 3 ? "num" : null }, h)))),
      el("tbody", {}, datasets.map((d) => {
        const del = el("button", { class: "link danger", type: "button" }, "Delete");
        del.addEventListener("click", async () => {
          if (!confirmAction(`Delete "${d.name}"? Clients will lose access to it.`)) return;
          del.disabled = true; del.textContent = "Deleting\u2026";
          try { await deleteDataset(d.id); flash(`Deleted "${d.name}".`, "ok"); }
          catch { flash("Couldn't delete that dataset.", "error"); del.disabled = false; del.textContent = "Delete"; }
        });
        return el("tr", {}, [
          el("td", {}, el("strong", {}, d.name)), el("td", {}, d.idColumn),
          el("td", { class: "num" }, num(d.rowCount)), el("td", { class: "num" }, num((d.clientKeys || []).length)),
          el("td", {}, formatWhen(d.uploadedAt)), el("td", { class: "actions" }, del),
        ]);
      })),
    ]);
    mount(listBox, el("div", { class: "table-scroll" }, table));
  });
  return unsub;
}
