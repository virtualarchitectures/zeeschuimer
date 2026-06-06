# Normalised CSV Schema

The `.csv` export for each platform uses a fixed 22-column schema so outputs from different platforms can be stacked and compared directly. This document describes each canonical field, how it is sourced from each platform, and any rules or caveats that apply.

---

## Canonical Fields

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `source_platform` | string | Platform identifier (e.g. `daft.ie`, `vrbo.com`) |
| 2 | `listing_id` | string / number | Platform-assigned listing ID |
| 3 | `url` | string | Absolute URL of the individual listing page |
| 4 | `listing_type` | string | `sale`, `rent`, `vacation_rental` (see taxonomy below) |
| 5 | `address` | string | Human-readable location string |
| 6 | `latitude` | number | WGS 84 latitude; blank where unavailable |
| 7 | `longitude` | number | WGS 84 longitude; blank where unavailable |
| 8 | `price_raw` | string | Price exactly as captured from the source |
| 9 | `price_amount` | number | Cleaned numeric price (no symbols or commas) |
| 10 | `price_currency` | string | `EUR` for all Irish platforms; `USD` for VRBO |
| 11 | `price_period` | string | `sale`, `per_month`, `per_week`, `per_night`, `other` |
| 12 | `property_type_raw` | string | Property type exactly as captured from the source |
| 13 | `property_type` | string | Normalised category (see taxonomy below) |
| 14 | `bedrooms` | integer | Bedroom count; blank where not applicable |
| 15 | `bathrooms` | integer | Bathroom count; blank where not applicable |
| 16 | `furnished` | string | Furnishing status; blank for most platforms |
| 17 | `floor_area_m2` | number | Floor area in square metres; blank where unavailable |
| 18 | `ber_rating` | string | Building Energy Rating (e.g. `A2`, `C1`); Irish platforms only |
| 19 | `agent` | string | Estate agent or landlord name |
| 20 | `date_posted` | string | ISO 8601 date the listing was first published |
| 21 | `description` | string | Listing description text (HTML stripped) |
| 22 | `image_url` | string | URL of the primary listing image, query parameters removed |

---

## Taxonomies

### `listing_type`

| Value | Meaning |
|-------|---------|
| `sale` | Property for outright purchase |
| `rent` | Long-term or medium-term rental (room, house, apartment) |
| `vacation_rental` | Short-stay holiday rental (VRBO only) |

### `property_type`

Normalised from the raw platform value by keyword matching:

| Value | Matched keywords |
|-------|-----------------|
| `apartment` | apartment, flat, bedsit, bed-sit |
| `house` | house, home, semi, terrace, detached, bungalow, cottage, villa, mansion, mews |
| `room` | room, digs, en suite, ensuite |
| `studio` | studio |
| `commercial` | commercial, office, retail, industrial, warehouse, shop |
| `land` | land, site, farm, acre |
| `other` | anything that does not match the above |

Matching is case-insensitive and applied to the raw `property_type_raw` string. The raw value is always preserved in `property_type_raw` for reference.

### `price_period`

| Value | Sources |
|-------|---------|
| `sale` | daft.ie (Buy category), myhome.ie, property.ie (sale/new_home) |
| `per_month` | daft.ie (Rent category), myhome.ie (to rent), property.ie (rent), digs.ie ("Per Month") |
| `per_week` | collegecribs.ie, hostingpower.ie, digs.ie ("Per Week", "Sun to Fri") |
| `per_night` | digs.ie ("Per Night"), vrbo.com |
| `other` | Any period string that does not match the above |

---

## Image URL Handling

Query parameter stripping is applied selectively based on the role of the query string for each platform:

| Platform | Query parameters | Role | Treatment | Downloadable? |
|----------|-----------------|------|-----------|---------------|
| daft.ie | `?signature=<hmac>` | HMAC credential required by CDN | **Retained** — full signed URL stored | ✓ |
| myhome.ie | None | — | No change | ✓ |
| property.ie | `?signature=<hmac>` | HMAC credential required by CDN | **Retained** — full signed URL stored | ✓ |
| digs.ie | None | — | No change; relative path prefixed with `https://www.digs.ie` | ✓ |
| collegecribs.ie | None | Signature embedded in path, not query string | No change | ✓ |
| hostingpower.ie | None | — | No change | ✓ |
| vrbo.com | `?impolicy=resizecrop&ra=fit&rw=455&rh=455` | Resize hint only, not access control | **Stripped** — base URL is fully accessible | ✓ |

All five platforms that capture images produce URLs that an automated scraper can use directly. The `?signature=` parameters on daft.ie and property.ie are HMAC signatures over the image transform path and do not appear to be time-limited, so the captured URLs remain valid after the collection session.

---

## Per-Platform Field Mapping

### daft.ie

| Canonical field | Source path | Notes |
|-----------------|-------------|-------|
| `listing_id` | `data.id` | |
| `url` | `"https://www.daft.ie" + data.seoFriendlyPath` | |
| `listing_type` | `data.category` | `"Buy"` → `sale`; anything else → `rent` |
| `address` | `data.title` | The listing title doubles as the address on daft |
| `latitude` | `data.point.coordinates[1]` | GeoJSON order is [lon, lat] — index 1 is latitude |
| `longitude` | `data.point.coordinates[0]` | |
| `price_raw` | `data.price` | Formatted string e.g. `"€310,000"` |
| `price_amount` | parsed from `data.price` | |
| `price_period` | derived from `listing_type` | `sale` or `per_month` |
| `property_type_raw` | `data.propertyType` | e.g. `"Terrace"`, `"Apartment"` |
| `bedrooms` | parsed from `data.numBedrooms` | Source is a string e.g. `"2 Bed"` — integer extracted |
| `bathrooms` | parsed from `data.numBathrooms` | Source is a string e.g. `"2 Bath"` — integer extracted |
| `floor_area_m2` | `data.floorArea.value` | Only populated when `data.floorArea.unit === "METRES_SQUARED"` |
| `ber_rating` | `data.ber.rating` | |
| `agent` | `data.seller.name` | |
| `date_posted` | `data.publishDate` | Unix milliseconds → ISO 8601 |
| `image_url` | `data.media.images[0].size720x480` | 720×480 px JPEG; daft watermark baked in; full signed URL retained — directly downloadable |

**Caveats:**
- `numBedrooms` and `numBathrooms` are human-readable strings, not integers. The first digit sequence is extracted.
- `seoFriendlyPath` is a relative path; `"https://www.daft.ie"` is prepended to form the absolute URL.
- The `point` coordinates follow GeoJSON order (longitude first), which is the reverse of the usual lat/lon convention.

---

### myhome.ie

| Canonical field | Source path | Notes |
|-----------------|-------------|-------|
| `listing_id` | `data.PropertyId` | |
| `url` | `"https://www.myhome.ie" + data.SeoUrl` | |
| `listing_type` | `data.PropertyClass` | Contains `"ToRent"` → `rent`; otherwise → `sale` |
| `address` | `data.DisplayAddress` | |
| `latitude` | `data.BrochureMap.latitude` | See caveat below |
| `longitude` | `data.BrochureMap.longitude` | |
| `price_raw` | `data.PriceAsString` | |
| `price_amount` | parsed from `data.PriceAsString` | Blank for some listings (e.g. price on application) |
| `price_period` | derived from `listing_type` | `sale` or `per_month` |
| `property_type_raw` | `data.PropertyType` | e.g. `"Detached House"`, `"Apartment"` |
| `bedrooms` | `data.NumberOfBeds` | Integer |
| `bathrooms` | `data.NumberOfBathrooms` | Integer |
| `floor_area_m2` | `data.SizeStringMeters` | |
| `ber_rating` | `data.BerRating` | |
| `agent` | `data.GroupName` | Estate agency group name |
| `date_posted` | `data.ActivatedOn` | ISO 8601 string with timezone offset |
| `image_url` | `data.MainPhoto` | Large variant (`_l.jpg`); no query parameters — directly downloadable. `MainPhotoWeb` (`_m.jpg`) is smaller and not used. |

**Caveats:**
- The API response also contains a `Location` object with `lat`/`lon` fields, but these are **always 0** and must not be used. Real coordinates come from `BrochureMap`.
- `SeoUrl` is a relative path; `"https://www.myhome.ie"` is prepended.
- `PriceAsString` is absent on some listings (auction, POA). `price_amount` will be blank in those cases.

---

### property.ie

| Canonical field | Source path | Notes |
|-----------------|-------------|-------|
| `listing_id` | `data.id` | String |
| `url` | `data.url` | Absolute URL |
| `listing_type` | `data.listing_type` | Already normalised by the module: `sale`, `rent`, `new_home`, `commercial` |
| `address` | `data.address` | |
| `latitude` | — | Not available; always blank |
| `longitude` | — | Not available; always blank |
| `price_raw` | `data.price` | Wide variety of formats (see caveat) |
| `price_amount` | parsed from `data.price` | First numeric value extracted |
| `price_period` | derived from `listing_type` | `sale` (sale/new_home), `per_month` (rent), `other` (commercial) |
| `property_type_raw` | `data.property_type` | e.g. `"Semi-Detached House"`, `"Apartment For Sale"` |
| `bedrooms` | `data.bedrooms` | Integer; null for new homes range listings |
| `bathrooms` | `data.bathrooms` | Integer; null for commercial |
| `furnished` | `data.furnished` | Rental listings only |
| `ber_rating` | `data.ber_rating` | |
| `agent` | `data.agent` | Null if not shown on listing card |
| `description` | `data.description` | Truncated search-result excerpt |
| `image_url` | `data.image_url` | 340×255 px with property.ie watermark; only size available from HTML scraping; full signed URL retained — directly downloadable |

**Caveats:**
- `price` has many formats: `"€350,000"`, `"€2,500  monthly"`, `"€69,200  yearly (€5,767 per month)"`, `"Rent Negotiable"`, `"Price on Application"`. The parser extracts the **first** numeric token, so `"€69,200 yearly"` yields `69200` (the annual figure, not the monthly one). `"Rent Negotiable"` yields blank.
- No geolocation data is captured from search results pages.
- New homes listings may have a bedroom range (`bedrooms` holds the minimum; `bedrooms_max` exists in the raw data but is not included in the normalised schema).
- Data is parsed from server-rendered HTML rather than an API, so field availability depends on what the listing card displays.
- `image_url` is null for some listings where no thumbnail is shown on the search results card.

---

### digs.ie

| Canonical field | Source path | Notes |
|-----------------|-------------|-------|
| `listing_id` | `data.id` | String |
| `url` | `data.url` | |
| `listing_type` | — | Always `rent` |
| `address` | `data.address` | Neighbourhood-level, not full address |
| `latitude` | — | Not available |
| `longitude` | — | Not available |
| `price_raw` | `data.price` | Bare numeric string e.g. `"900.00"` |
| `price_amount` | `parseFloat(data.price)` | |
| `price_period` | `data.period` | Normalised from: `"Per Month"`, `"Per Week"`, `"Per Night"`, `"Sun to Fri"` |
| `property_type_raw` | `data.property_type` | Host's property type: `"Family Home"`, `"Apartment"`, `"House"` |
| `bedrooms` | — | Not captured; digs are room-level listings |
| `bathrooms` | — | Not captured |
| `agent` | `data.posted_by` | Name of the person posting the listing |
| `date_posted` | `data.date_posted` | DD/MM/YYYY → ISO date string |
| `image_url` | `data.image_url` | `/photos/display/[hash].webp` (medium size); `https://www.digs.ie` prepended to form absolute URL — directly downloadable. Blank for listings with no photo. |

**Caveats:**
- `price` contains no currency symbol — it is a plain decimal string. Currency is assumed EUR.
- `"Sun to Fri"` is a 6-day weekly cycle common for student digs; it is mapped to `per_week`.
- `property_type` describes the **host's property** (the dwelling), not the rented space. All digs listings are room rentals regardless of this value.
- Data is minimal compared to other platforms; most optional fields will be blank.
- Images are WebP format. Two sizes exist on the listing page (`display` medium, `main` full-size); the medium `display` variant is captured from the search card.

---

### collegecribs.ie

| Canonical field | Source path | Notes |
|-----------------|-------------|-------|
| `listing_id` | `data.id` | |
| `url` | `"https://www.collegecribs.ie/listings/" + data.slug` | |
| `listing_type` | — | Always `rent` |
| `address` | `data.address.full_string` | Full formatted address including eircode |
| `latitude` | `data.address.latitude` | Zero-guarded (treated as absent when 0) |
| `longitude` | `data.address.longitude` | Zero-guarded |
| `price_raw` | Formatted from lowest bedroom price | `"€225.00"` |
| `price_amount` | `min(bedrooms[].price) / 100` | Prices are stored in **cents** |
| `price_currency` | `EUR` | |
| `price_period` | `bedrooms[].price_type` of cheapest room | `per_week` or `per_month` |
| `property_type_raw` | `data.accomodation_type` | e.g. `"rooms_to_rent_in_a_family_house"` |
| `property_type` | — | Always `room` |
| `bedrooms` | `data.available_bedrooms` | Count of currently available rooms |
| `bathrooms` | `data.bathrooms` | Bathrooms in the whole property |
| `furnished` | `data.furnished` | Boolean, stored as string `"true"` / `"false"` |
| `date_posted` | `data.published_at` | ISO 8601 timestamp |
| `description` | `data.description` | HTML stripped |
| `image_url` | `data.photos[0].medium.normal` | `photos[0]` is always the `medium` size key (main photo); subsequent photos use `thumb`. URL used as-is — directly downloadable |

**Caveats:**
- Prices are stored in **integer cents** (e.g. `22500` = €225.00). Division by 100 is applied before output.
- A listing may have multiple bedroom types at different prices (e.g. single and double rooms). The **cheapest available bedroom** is used as the representative price. Both `price_raw` and `price_period` reflect that bedroom's values.
- `address.latitude` and `address.longitude` are sometimes `0` (indicating missing data), not a location. Zero values are treated as absent.
- `accomodation_type` uses snake_case values such as `"rooms_to_rent_in_a_family_house"` — these are preserved in `property_type_raw` for reference.
- The photo URL is a Rails Active Storage redirect; the final destination image URL is resolved at request time.

---

### hostingpower.ie

| Canonical field | Source path | Notes |
|-----------------|-------------|-------|
| `listing_id` | `data.id` | String |
| `url` | `data.url` | |
| `listing_type` | — | Always `rent` |
| `address` | `data.neighbourhood + ", " + data.district` | Composed from two fields |
| `latitude` | — | Not available |
| `longitude` | — | Not available |
| `price_raw` | `data.price` | Includes unit, e.g. `"€210 /week"` |
| `price_amount` | parsed from `data.price` | First numeric value extracted |
| `price_currency` | `EUR` | |
| `price_period` | — | Always `per_week` |
| `property_type_raw` | `data.room_type` | e.g. `"Double Room"`, `"Single Room"`, `"Double Studio"` |
| `property_type` | — | Always `room` |
| `bedrooms` | — | Not applicable; room-level listings |
| `bathrooms` | `data.bathroom_type` | `1` if a bathroom type is specified, `0` if null |
| `image_url` | `data.image_url` | AWS S3 URL (`hosting-pictures.s3.eu-west-1.amazonaws.com`); no query parameters — directly downloadable. Blank for listings with no photo. |

**Caveats:**
- All listings are weekly room rentals; `price_period` is hardcoded to `per_week`.
- `address` is a neighbourhood and district composite, not a street address. No coordinates are available.
- `bathrooms` is a binary field: `1` means a private bathroom is associated with the room, `0` means it is not specified or absent. The `bathroom_type` value (e.g. `"Private Bathroom"`) is not preserved in the normalised output.
- The `rating` field in the source data is always `null` in observed data.
- Transport accessibility (`transport` array) and guest count (`guest_count`) are available in the raw NDJSON but are not included in the normalised schema.

---

### vrbo.com

| Canonical field | Source path | Notes |
|-----------------|-------------|-------|
| `listing_id` | `data.id` | String |
| `url` | `data.cardLink.resource.value` | Full URL including search context parameters |
| `listing_type` | — | Always `vacation_rental` |
| `address` | — | Not available; always blank |
| `latitude` | `data.latitude` | Injected from deferred map-marker response |
| `longitude` | `data.longitude` | Injected from deferred map-marker response |
| `price_raw` | LEAD `price.formatted` in `priceSection` | e.g. `"$209"` |
| `price_amount` | parsed from `price_raw` | |
| `price_currency` | `USD` | VRBO Ireland search results price in USD |
| `price_period` | — | Always `per_night` |
| `property_type_raw` | First segment of `headingSection.messages[0].text` | e.g. `"Apartment"`, `"House"` |
| `bedrooms` | parsed from `headingSection.messages[0].text` | Regex: `(\d+) bedroom` |
| `bathrooms` | parsed from `headingSection.messages[0].text` | Regex: `(\d+)+? bathroom` — `2+` treated as `2` |
| `description` | `data.headingSection.heading` | The listing title |
| `image_url` | `data.mediaSection.gallery.media[0].media.url` | Resize hint (`?impolicy=resizecrop&ra=fit&rw=455&rh=455`) stripped; base URL serves full-resolution image — directly downloadable |

**Caveats:**
- Data comes from a **GraphQL API response** (`@defer` streamed NDJSON). The full response is stored as-is; the normaliser navigates the nested structure at export time.
- There is no text address in the GraphQL response. `headingSection.locationInfo` is consistently empty in observed data. Location is only available as coordinates.
- The displayed price may be a **weekly discount rate** rather than the standard nightly rate. VRBO shows the discounted `LEAD` price when a weekly or monthly reduction applies; the full `STRIKEOUT` price is not captured in the normalised output.
- Coordinates (`latitude`, `longitude`) are extracted from a **separate deferred response** (map markers). The VRBO module injects these into the stored item at capture time, so they are available as top-level fields.
- The URL (`cardLink.resource.value`) includes search session parameters (dates, guests, region). These are preserved as captured and will differ between collection sessions.
- `price_currency` is `USD` even when searching from Ireland. VRBO returns USD pricing in its GraphQL API regardless of the user's locale.

---

## Fields Not Included in the Normalised Schema

The following fields exist in the raw NDJSON but are excluded from the normalised CSV. They remain accessible via the `.ndjson` export.

| Platform | Excluded fields | Reason |
|----------|----------------|--------|
| All | `source_platform_url`, `source_url`, `timestamp_collected`, `last_updated`, `user_agent`, `nav_index` | Capture metadata rather than listing data |
| daft.ie | `seller.*` (full object), `media.images` (full array), `sections`, `saleType`, `ber.epi`, `pageBranding.*`, `stampDutyValue`, `pricePerSqM` | Detail beyond comparative scope; full signed image array in raw NDJSON |
| myhome.ie | `Negotiator.*`, `Photos` (full array), `OpenViewings`, `TravelTimes`, `CustomData`, `GroupLogoUrl` | Detail beyond comparative scope |
| property.ie | `bedrooms_max` | Range bedrooms not in schema |
| collegecribs.ie | `bedrooms[]` (full array), `photos` (full array), `distance`, `promotion.*` | Full room and photo arrays in raw NDJSON; promo not comparative |
| hostingpower.ie | `transport[]`, `guest_count`, `room_label`, `rating` | Transport/rating not consistently populated |
| vrbo.com | `analyticsEvents`, `mediaSection` (full), `summarySections`, `priceSection` (full), `compareSection` | Analytics payload; full media and price breakdown in raw NDJSON |
