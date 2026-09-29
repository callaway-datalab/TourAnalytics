import { el, mount, formatWhen, num, confirmAction, subNav } from "../ui.js";
import { watchAdminDatasets, uploadDataset, deleteDataset, uploadErrorMessage } from "../store.js";
import { parseCsv, tableFromCsvRows, buildDataset } from "../data.js";

export async function render(main, { flash }) {
  const file = el("input", { type: "file", accept: ".csv,.parquet", required: true });
  const idColumn = el("input", { value: "client_id", required: true });
  const name = el("input", { placeholder: "Defaults to the file name" });
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
        const dataset = buildDataset(table, idColumn.value.trim() || "client_id");
        submit.textContent = `Uploading (${dataset.byClient.size} people)\u2026`;
        const displayName = name.value.trim() || f.name.replace(/\.(csv|parquet)$/i, "");
        const people = dataset.byClient.size;
        const result = await uploadDataset(displayName, description.value.trim(), dataset, (done, total) => {
          submit.textContent = `Uploading (${people} people)\u2026 ${Math.min(99, Math.round((done / total) * 100))}%`;
        });

        let msg = `Added "${displayName}": ${num(dataset.rowCount)} rows for ${num(result.clients)} ${result.clients === 1 ? "person" : "people"}.`;
        if (dataset.blankIdRows) msg += ` ${num(dataset.blankIdRows)} rows have no value in "${dataset.idColumn}" and won't be shown to anyone.`;
        flash(msg, "ok");
        form.reset(); idColumn.value = "client_id";
      } catch (err) {
        flash(uploadErrorMessage(err, "that data file"), "error");
      } finally {
        submit.disabled = false; submit.textContent = "Upload data";
      }
    },
  }, [
    el("label", {}, ["File (.csv or .parquet)", file]),
    el("label", {}, ["Column that says who each row belongs to", idColumn,
      el("small", {}, "Use the exact column name. The values in it are what you'll enter when you create each person's access code. Matching ignores capital letters and spaces.")]),
    el("label", {}, ["Name shown to clients", name, el("small", {}, "Uploading with a name that already exists replaces that data.")]),
    el("label", {}, ["Short description (optional)", description]),
    el("div", {}, submit),
  ]);

  mount(main, [
    subNav([["#/admin/datasets", "Upload"], ["#/admin/analyze", "Analyze"]], "#/admin/datasets"),
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
