zeeschuimer.register_module(
  "HostingPower.ie (Detail)",
  "hostingpower.ie",
  function (response, source_platform_url, source_url) {
    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");
    if (!["hostingpower.ie"].includes(domain)) return [];

    let request_url;
    try {
      request_url = new URL(source_url);
    } catch (e) {
      return [];
    }

    // Only fire on individual listing pages: /details/{id}
    const path = request_url.pathname;
    const idMatch = path.match(/^\/details\/(\d+)$/);
    if (!idMatch) return [];
    const id = idMatch[1];

    let doc;
    try {
      doc = new DOMParser().parseFromString(response, "text/html");
    } catch (e) {
      return [];
    }

    // Room type and bathroom type: h6.text-orange holds two <strong> children —
    // first is room type ("Double Room"), second is bathroom type ("Private Bathroom").
    const typeH6 = doc.querySelector("h6.text-orange");
    const typeStrongs = typeH6
      ? Array.from(typeH6.querySelectorAll("strong"))
      : [];
    const room_type = typeStrongs.length > 0
      ? typeStrongs[0].textContent.trim()
      : null;
    const bathroom_type_heading = typeStrongs.length > 1
      ? typeStrongs[1].textContent.trim()
      : null;

    // Location: h3.fw-600 mirrors the search-card structure —
    // neighbourhood before <strong>, district inside <strong>,
    // optional room label in (parentheses) after <strong>.
    const h3El = doc.querySelector("h3.fw-600");
    let neighbourhood = null, district = null, room_label = null;
    if (h3El) {
      const strongEl = h3El.querySelector("strong");
      district = strongEl ? strongEl.textContent.trim() : null;
      let textBefore = "", textAfter = "";
      let foundStrong = false;
      for (const node of h3El.childNodes) {
        if (node.nodeType === 3) {
          if (!foundStrong) textBefore += node.textContent;
          else textAfter += node.textContent;
        } else if (node.nodeName === "STRONG") {
          foundStrong = true;
        }
      }
      neighbourhood = textBefore.trim() || null;
      const labelMatch = textAfter.match(/\(([^)]+)\)/);
      room_label = labelMatch ? labelMatch[1].trim() : null;
    }

    // Price: span.rent holds the numeric weekly amount; reconstruct as "€X/week".
    const rentEl = doc.querySelector("span.rent");
    const price = rentEl ? "€" + rentEl.textContent.trim() + "/week" : null;

    // Bills included: the /week label span also contains "All bills included" when applicable.
    const weekSpan = doc.querySelector("span.h6.fw-400.text-gray");
    let bills_included = weekSpan
      ? /all\s+bills\s+included/i.test(weekSpan.textContent)
      : false;

    // Helper: given an h4 heading text, find its parent .book-room-wrap and return
    // a map of label → value from the visible d-flex rows inside it.
    // Hidden rows use class "d-none" instead of "d-flex" and are not selected.
    function extract_info_section(heading) {
      for (const h4 of doc.querySelectorAll("h4")) {
        if (h4.textContent.trim() !== heading) continue;
        const wrap = h4.closest(".book-room-wrap");
        if (!wrap) continue;
        const map = {};
        wrap
          .querySelectorAll("div.d-flex.justify-content-between")
          .forEach((row) => {
            const labelEl = row.querySelector("div.no-word-break-custom h6");
            const valueEl = row.querySelector("div.mw-278 h6");
            if (!labelEl || !valueEl) return;
            const label = labelEl.textContent.trim();
            const value = valueEl.textContent.trim();
            if (label && value) map[label] = value;
          });
        return map;
      }
      return {};
    }

    // More Information section: Bills, Bathroom, Gender Allowed, Room Reference.
    const moreInfo = extract_info_section("More Information");
    const bathroom_type = moreInfo["Bathroom"] || bathroom_type_heading || null;
    const gender_policy = moreInfo["Gender Allowed"] || null;
    const room_ref = moreInfo["Room Reference"] || null;
    if (!bills_included && moreInfo["Bills"]) {
      bills_included = /included/i.test(moreInfo["Bills"]);
    }

    // Transport section: collect as array of {type, distance} objects.
    const transportMap = extract_info_section("Transport Information");
    const transport = Object.entries(transportMap).map(([type, distance]) => ({
      type,
      distance,
    }));

    // Description sections: h4 headings inside div.details-content-wrap followed
    // by h6 (and possibly p) siblings until the next h4.
    function extract_description(label) {
      const wrap = doc.querySelector("div.details-content-wrap");
      if (!wrap) return null;
      for (const h4 of wrap.querySelectorAll("h4")) {
        if (h4.textContent.trim() !== label) continue;
        const parts = [];
        let el = h4.nextElementSibling;
        while (el && el.tagName !== "H4") {
          const text = el.textContent.trim();
          if (text) parts.push(text);
          el = el.nextElementSibling;
        }
        return parts.join("\n\n") || null;
      }
      return null;
    }

    const description_property = extract_description("The Property");
    const description_location = extract_description("The Location");
    const description_host = extract_description("The Host");

    // Coordinates: hidden inputs with id="lat"/"lng" using a `val` attribute
    // (not the standard `value` attribute).
    const latEl = doc.querySelector("input#lat");
    const lngEl = doc.querySelector("input#lng");
    const latitude = latEl
      ? parseFloat(latEl.getAttribute("val")) || null
      : null;
    const longitude = lngEl
      ? parseFloat(lngEl.getAttribute("val")) || null
      : null;

    // Photos: href attributes on custom-lightbox-trigger anchors pointing to S3.
    // The "View Pictures" button and all hidden gallery links share the same class.
    const seen = new Set();
    const photos = Array.from(
      doc.querySelectorAll(
        "a.custom-lightbox-trigger[href*='hosting-pictures.s3']"
      )
    )
      .map((a) => a.getAttribute("href"))
      .filter((href) => {
        if (!href || seen.has(href)) return false;
        seen.add(href);
        return true;
      });

    // og:image is the canonical primary image; prepend if not already present.
    const ogImageEl = doc.querySelector('meta[property="og:image"]');
    const og_image = ogImageEl ? ogImageEl.getAttribute("content") : null;
    if (og_image && !seen.has(og_image)) photos.unshift(og_image);

    const image_url = og_image || (photos.length > 0 ? photos[0] : null);

    return [
      {
        id,
        url: source_platform_url,
        room_ref,
        neighbourhood,
        district,
        room_label,
        room_type,
        bathroom_type,
        gender_policy,
        price,
        bills_included,
        transport,
        description_property,
        description_location,
        description_host,
        latitude,
        longitude,
        photos,
        image_url,
      },
    ];
  },
  null,
  "hostingpower.ie-detail"
);
