const background = browser.extension.getBackgroundPage();
const downloadUrls = new Map();

/**
 * StreamSaver init
 * Unused for now - see documentation for the download_blob function.
 */
/*var fileStream;
var writer;
var encode = TextEncoder.prototype.encode.bind(new TextEncoder);

streamSaver.mitm = 'mitm.html';
// Abort the download stream when leaving the page
window.isSecureContext && window.addEventListener('beforeunload', evt => {
    writer.abort()
    writer = undefined;
    fileStream = undefined;
})*/

/**
 * Create DOM element
 *
 * Convenience function because we can't use innerHTML very well in an
 * extension context.
 *
 * @param tag  Tag of element
 * @param attributes  Element attributes
 * @param content  Text content of attribute
 * @param prepend_icon  Font awesome icon ID to prepend to content
 * @returns {*}
 */
function createElement(
  tag,
  attributes = {},
  content = undefined,
  prepend_icon = undefined
) {
  let element = document.createElement(tag);
  for (let attribute in attributes) {
    element.setAttribute(attribute, attributes[attribute]);
  }
  if (content && typeof content === "object" && "tagName" in content) {
    element.appendChild(content);
  } else if (content !== undefined) {
    element.textContent = content;
  }

  if (prepend_icon) {
    const icon_element = document.createElement("i");
    icon_element.classList.add("fa");
    icon_element.classList.add("fa-" + prepend_icon);
    element.textContent = " " + element.textContent;
    element.prepend(icon_element);
  }

  return element;
}


/**
 * Manage availability of interface buttons
 *
 * Some buttons are only available when a 4CAT URL has been provided, or when
 * items have been collected, etc. This function is called periodically to
 * enable or disable buttons accordingly.
 */
function activate_buttons() {
  document.querySelectorAll("td button").forEach((button) => {
    let current = button.disabled;
    let items = parseInt(
      button.parentNode.parentNode.querySelector(".num-items").innerText
    );
    let new_status = current;

    if (
      button.classList.contains("download-ndjson") ||
      button.classList.contains("download-csv") ||
      button.classList.contains("reset")
    ) {
      new_status = !(items > 0);
    }

    if (new_status !== current) {
      button.disabled = new_status;
    }
  });
}

/**
 * Toggle data capture for a platform
 *
 * Callback; platform depends on the button this callback is called through.
 *
 * @param e
 * @returns {Promise<void>}
 */
async function toggle_listening(e) {
  let platform = e.target.getAttribute("name");
  let now = await background.browser.storage.local.get([platform]);
  let current = !!parseInt(now[platform]);
  let updated = current ? 0 : 1;
  e.target.parentNode.parentNode.parentNode.parentNode.setAttribute(
    "data-enabled",
    updated
  );

  await background.browser.storage.local.set({ [platform]: String(updated) });
}

/**
 * Update favicon depending on whether capture is enabled
 */
function update_icon() {
  const any_enabled = Array.from(
    document.querySelectorAll(".toggle-switch input")
  ).filter((item) => item.checked);
  const path =
    any_enabled.length > 0
      ? "/images/zeeschuimer-icon-active.png"
      : "/images/zeeschuimer-icon-inactive.png";
  document.querySelector("link[rel~=icon]").setAttribute("href", path);
}

/**
 * Get Zeeschuimer stats
 *
 * Loads the amount of items collected, etc. This function is called
 * periodically to keep the numbers in the interface updated as items are
 * coming in.
 *
 * @returns {Promise<void>}
 */
async function get_stats() {
  let response = [];
  let platform_map = [];
  Object.keys(background.zeeschuimer.modules).forEach(function (platform) {
    platform_map[platform] = background.zeeschuimer.modules[platform].name;
  });
  for (let module in background.zeeschuimer.modules) {
    response[module] = await background.db.items
      .where("source_platform")
      .equals(module)
      .count();
  }

  for (let platform in response) {
    let row_id = "stats-" + platform.replace(/[^a-zA-Z0-9]/g, "");
    let new_num_items = parseInt(response[platform]);
    if (!document.querySelector("#" + row_id)) {
      let toggle_field = "zs-enabled-" + platform;
      let enabled = await background.browser.storage.local.get([toggle_field]);
      enabled =
        enabled.hasOwnProperty(toggle_field) &&
        !!parseInt(enabled[toggle_field]);
      let row = createElement("tr", {
        id: row_id,
        "data-enabled": enabled ? "1" : "0",
      });

      // checkbox stuff
      let checker = createElement("label", { for: toggle_field });
      checker.appendChild(
        createElement("input", {
          id: toggle_field,
          name: toggle_field,
          type: "checkbox",
        })
      );
      checker.appendChild(createElement("span", { class: "toggle" }));
      if (enabled) {
        checker.firstChild.setAttribute("checked", "checked");
      }
      checker.addEventListener("change", toggle_listening);

      const platformImg = createElement("img", {
        src:
          "/images/platform-icons/" +
          platform.split(".")[0].split("-")[0] +
          ".png",
        alt: "",
      });
      platformImg.onerror = function () {
        this.onerror = null;
        this.src = this.src.replace(".png", ".jpg");
      };
      row.appendChild(
        createElement("td", { class: "platform-icon" }, platformImg)
      );
      row.appendChild(
        createElement(
          "td",
          {},
          createElement("div", { class: "toggle-switch" }, checker)
        )
      );
      row.appendChild(
        createElement(
          "td",
          {},
          createElement(
            "a",
            {
              href:
                "https://" + background.zeeschuimer.modules[platform]["domain"],
            },
            platform_map[platform]
          )
        )
      );
      row.appendChild(
        createElement(
          "td",
          { class: "num-items" },
          new Intl.NumberFormat().format(response[platform])
        )
      );

      let actions = createElement("td");
      let clear_button = createElement(
        "button",
        { "data-platform": platform, class: "reset" },
        "Delete"
      );
      let download_button = createElement(
        "button",
        {
          "data-platform": platform,
          class: "download-ndjson",
        },
        ".ndjson"
      );
      let csv_button = createElement(
        "button",
        { "data-platform": platform, class: "download-csv" },
        ".csv"
      );
      actions.appendChild(clear_button);
      actions.appendChild(download_button);
      actions.appendChild(csv_button);

      row.appendChild(actions);
      document.querySelector("#item-table tbody").appendChild(row);

      if (["property.ie", "digs.ie"].includes(platform)) {
        const spacer = createElement("tr", { class: "module-spacer" });
        spacer.appendChild(createElement("td", { colspan: "5" }));
        document.querySelector("#item-table tbody").appendChild(spacer);
      }
    } else if (
      new_num_items !==
      parseInt(document.querySelector("#" + row_id + " .num-items").innerText)
    ) {
      document.querySelector("#" + row_id + " .num-items").innerText =
        new Intl.NumberFormat().format(new_num_items);
    }
  }

  activate_buttons();
  update_icon();
  init_tooltips();
}

/**
 * Handle button clicks
 *
 * Since buttons are created dynamically, the buttons don't have individual
 * listeners but this function listens to incoming events and dispatches
 * accordingly.
 *
 * @param event
 * @returns {Promise<void>}
 */
async function button_handler(event) {
  if (event.target.matches(".reset")) {
    let platform = event.target.getAttribute("data-platform");
    await background.db.items
      .where("source_platform")
      .equals(platform)
      .delete();
  } else if (event.target.matches(".reset-all")) {
    await background.db.items.clear();
  } else if (event.target.matches(".download-ndjson")) {
    let platform = event.target.getAttribute("data-platform");
    let date = new Date();
    event.target.classList.add("loading");

    //let blob = await download_blob(platform, 'zeeschuimer-export-' + platform + '-' + date.toISOString().split(".")[0].replace(/:/g, "") + '.ndjson');
    let blob = await get_blob(platform);
    let filename =
      platform +
      "-" +
      date.toISOString().split(".")[0].replace(/:/g, "") +
      ".ndjson";
    const downloadUrl = window.URL.createObjectURL(blob);
    const downloadId = await browser.downloads.download({
      url: window.URL.createObjectURL(blob),
      filename: filename,
      conflictAction: "uniquify",
    });
    downloadUrls.set(downloadId, downloadUrl);

    event.target.classList.remove("loading");
  } else if (event.target.matches(".download-csv")) {
    let platform = event.target.getAttribute("data-platform");
    let date = new Date();
    event.target.classList.add("loading");
    let blob = await get_csv_blob(platform);
    let filename =
      platform +
      "-" +
      date.toISOString().split(".")[0].replace(/:/g, "") +
      ".csv";
    const downloadUrl = window.URL.createObjectURL(blob);
    const downloadId = await browser.downloads.download({
      url: downloadUrl,
      filename: filename,
      conflictAction: "uniquify",
    });
    downloadUrls.set(downloadId, downloadUrl);
    event.target.classList.remove("loading");
  } else if (event.target.matches("#import-button")) {
    if (
      !confirm(
        "Importing data will remove all items currently stored. Are you sure?"
      )
    ) {
      return;
    }

    await background.db.items.clear();

    event.target.setAttribute("disabled", "disabled");
    let file = document.querySelector("#ndjson-file").files[0];
    let reader = new FileReader();
    reader.readAsText(file);
    reader.addEventListener("load", async function (e) {
      let imported_items = 0;
      let skipped = 0;
      let jsons = reader.result.split("\n");
      for (let index in jsons) {
        let raw_json = jsons[index];
        if (!raw_json) {
          continue;
        }

        try {
          let imported = JSON.parse(raw_json);

          // is this original format or 4CAT-ified? in the latter case, convert back
          if ("__import_meta" in imported) {
            let reformatted_import = imported["__import_meta"];
            reformatted_import["data"] = {};
            for (const field in imported) {
              if (field === "__import_meta") {
                continue;
              }
              reformatted_import["data"][field] = imported[field];
            }
            imported = reformatted_import;
          }

          await background.db.items.add(imported);
          imported_items += 1;
        } catch (e) {
          skipped += 1;
          console.log("Skipping invalid JSON string: (" + e + ") " + raw_json);
        }
      }

      if (skipped) {
        alert(
          "Imported " + imported_items + " item(s), " + skipped + " skipped."
        );
      } else {
        alert("Imported " + imported_items + " item(s).");
      }
    });

    reader.addEventListener("loadend", function (e) {
      event.target.removeAttribute("disabled");
    });
  } else if (event.target.matches("#toggle-advanced-mode")) {
    let section = document.querySelector("#advanced-mode");
    let is_hidden = section.getAttribute("aria-hidden") == "true";
    if (is_hidden) {
      section.setAttribute("aria-hidden", "false");
      event.target.innerText = "Hide advanced options";
    } else {
      section.setAttribute("aria-hidden", "true");
      event.target.innerText = "Show advanced options";
    }

    event.stopPropagation();
    return false;
  }

  get_stats();
}


/**
 * Get a NDJON dump of items
 *
 * Retuens a Blob with all items in it as JSON files, delimited with newlines.
 * This file can be uploaded to e.g. 4CAT.
 *
 * @param platform
 * @returns {Promise<Blob>}
 */
async function get_blob(platform) {
  let ndjson = [];

  await iterate_items(platform, function (item) {
    ndjson.push(JSON.stringify(item) + "\n");
  });

  return new Blob(ndjson, { type: "application/x-ndjson" });
}

/**
 * Use StreamSaver to download a Blob
 *
 * This is advantageous for very large files because the download starts
 * while items are being collected, instead of only after an NDJSON has been
 * created and stored in memory. However, StreamSaver is kind of awkward to
 * use in an extension context, so for now this function is not used.
 *
 * @param platform
 * @param filename
 * @returns {Promise<void>}
 */
async function download_blob(platform, filename) {
  if (!fileStream) {
    fileStream = streamSaver.createWriteStream(filename);
    writer = fileStream.getWriter();
  }

  await iterate_items(platform, function (item) {
    writer.write(encode(JSON.stringify(item) + "\n"));
  });

  await writer.close();
  writer = undefined;
  fileStream = undefined;
}

/**
 * Iterate through all collected items for a given platform
 *
 * A callback function will be called with each item as its only argument. This
 * function iterates over the items in chunks of 500, to avoid issues with
 * large datasets that are too much for the browser to handle in one go.
 *
 * @param platform  Platform to iterate items for
 * @param callback  Callback to call for each item
 * @returns {Promise<void>}
 */
async function iterate_items(platform, callback) {
  let previous;
  while (true) {
    let items;
    // we paginate here in this somewhat roundabout way because firefox
    // crashes if we query everything in one go for large datasets
    if (!previous) {
      items = await background.db.items
        .orderBy("id")
        .filter((item) => item.source_platform === platform)
        .limit(500)
        .toArray();
    } else {
      items = await background.db.items
        .where("id")
        .aboveOrEqual(previous.id)
        .filter(
          fastForward(
            previous,
            "id",
            (item) => item.source_platform === platform
          )
        )
        .limit(500)
        .toArray();
    }

    if (!items.length) {
      break;
    }

    items.forEach((item) => {
      callback(item);
      previous = item;
    });
  }
}

/**
 * Listen for completed downloads, and if the download that has completed
 * was one of our object URLs, then revoke it.
 * @param delta object representing the changes that caused this event to fire.
 */
function downloadListener(delta) {
  if (delta.state && delta.state.current === "complete") {
    const url = downloadUrls.get(delta.id);
    if (url) {
      window.URL.revokeObjectURL(url);
      downloadUrls.delete(delta.id);
    }
  }
}

/**
 * Helper function for Dexie pagination
 *
 * Used to paginate through results where large result sets may be too much for
 * Firefox to handle.
 *
 * See https://dexie.org/docs/Collection/Collection.offset().
 *
 * @param lastRow  Last seen row (that should not be included)
 * @param idProp  Property to compare between items
 * @param otherCriteria  Other filters, as a function that returns a bool.
 * @returns {(function(*): (*|boolean))|*}
 */
function fastForward(lastRow, idProp, otherCriteria) {
  let fastForwardComplete = false;
  return (item) => {
    if (fastForwardComplete) return otherCriteria(item);
    if (item[idProp] === lastRow[idProp]) {
      fastForwardComplete = true;
    }
    return false;
  };
}

/**
 * Init!
 */
document.addEventListener("DOMContentLoaded", async function () {
  get_stats();
  setInterval(get_stats, 1000);

  document.addEventListener("click", button_handler);

  browser.downloads.onChanged.addListener(downloadListener);
});
