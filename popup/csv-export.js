/**
 * CSV export logic for DS-Property-Percolator.
 *
 * This file is fork-specific — the upstream zeeschuimer project has no CSV
 * export. Keeping it separate from interface.js makes future upstream merges
 * cleaner: changes here do not affect the diff of interface.js.
 *
 * These functions are globals used by the .download-csv handler and button
 * creation in interface.js. They reference `background` (the background page
 * handle) and `iterate_items`, both defined in interface.js. Because all
 * function bodies are only invoked at runtime (on button click), the load
 * order between this file and interface.js does not matter for correctness.
 */

/**
 * Encode one CSV row per RFC 4180: quote fields containing commas, quotes, or newlines.
 *
 * @param {Array} values
 * @returns {string}
 */
function csv_row(values) {
  return values
    .map((v) => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    })
    .join(",");
}

/**
 * Get a normalised CSV dump of items for a platform.
 *
 * Uses the fixed canonical schema defined in normalize.js so outputs from
 * different platforms have identical columns and can be stacked for
 * comparative analysis. Single-pass because the column list is predetermined.
 *
 * @param {string} platform
 * @returns {Promise<Blob>}
 */
async function get_csv_blob(platform) {
  const rows = [csv_row(NORMALIZED_FIELDS)];

  await iterate_items(platform, function (item) {
    const norm = normalize_item(item);
    if (!norm) return;
    rows.push(csv_row(NORMALIZED_FIELDS.map((f) => norm[f] ?? "")));
  });

  return new Blob([rows.join("\n")], { type: "text/csv" });
}
