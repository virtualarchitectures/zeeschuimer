zeeschuimer.register_module(
  "Digs",
  "digs.ie",
  function (response, source_platform_url, source_url) {
    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");

    if (!["digs.ie"].includes(domain)) {
      return [];
    }

    let path;
    try {
      path = new URL(source_url).pathname;
    } catch (e) {
      return [];
    }
    if (path !== "/properties") {
      return [];
    }

    let doc;
    try {
      doc = new DOMParser().parseFromString(response, "text/html");
    } catch (e) {
      return [];
    }

    const items = [];

    doc.querySelectorAll("div.search_result").forEach((card) => {
      const postItem = card.querySelector("span.postItem[data-postid]");
      if (!postItem) return;

      const id = postItem.getAttribute("data-postid");
      if (!id) return;

      const title_link = card.querySelector("a.h3.bold");
      const title = title_link ? title_link.textContent.trim() : null;
      const href = title_link ? title_link.getAttribute("href") : null;
      const url = href ? "https://www.digs.ie" + href : null;

      const price_el = card.querySelector(
        "div.bg-secondary.hpad.font-lg.text-center.line-height-xl"
      );
      const price = price_el ? price_el.textContent.trim() : null;

      const period_el = card.querySelector("span.pull-left");
      const period = period_el ? period_el.textContent.trim() : null;

      const location_el = card.querySelector("div.post-location-snippet");
      let address = null;
      if (location_el) {
        const icon = location_el.querySelector("i");
        if (icon) icon.remove();
        address = location_el.textContent.trim();
      }

      const date_el = card.querySelector("div.posted_meta_data span");
      let date_posted = null;
      if (date_el) {
        const date_match = date_el.textContent.match(/(\d{2}\/\d{2}\/\d{4})/);
        date_posted = date_match ? date_match[1] : null;
      }

      const poster_el = card.querySelector("a.bold.notranslate");
      const posted_by = poster_el ? poster_el.textContent.trim() : null;

      const type_el = card.querySelector("span.pull-right.badge");
      const property_type = type_el ? type_el.textContent.trim() : null;

      const imgEl = card.querySelector("img[src^='/photos/']");
      const image_url = imgEl
        ? "https://www.digs.ie" + imgEl.getAttribute("src")
        : null;

      items.push({
        id: id,
        url: url,
        title: title,
        address: address,
        price: price,
        period: period,
        property_type: property_type,
        date_posted: date_posted,
        posted_by: posted_by,
        image_url: image_url,
      });
    });

    return items;
  }
);
